"use client";

import { getAccount, getConnectorClient } from "@wagmi/core";
import { toHex } from "viem";
import { config } from "@/lib/wagmi";
import { targetChain } from "@/lib/chains";

export const TARGET_CHAIN_ID = targetChain.id;

export class WrongNetworkError extends Error {
  constructor() {
    super(`Please switch your wallet to ${targetChain.name} (chain ${targetChain.id}).`);
    this.name = "WrongNetworkError";
  }
}

type RequestFn = (method: string, params: unknown[]) => Promise<unknown>;

/** EIP-1193 request through the configured connector (falls back to window.ethereum). */
async function getRequest(): Promise<RequestFn> {
  try {
    const client = await getConnectorClient(config);
    return ((method: string, params: unknown[]) =>
      client.request({ method, params } as never)) as RequestFn;
  } catch {
    const eth = (
      window as unknown as {
        ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      }
    ).ethereum;
    if (!eth) throw new WrongNetworkError();
    return (method, params) => eth.request({ method, params });
  }
}

/** The chain the wallet is currently on, or null if it can't be read. */
export async function currentChainId(): Promise<number | null> {
  try {
    const request = await getRequest();
    const hex = await request("eth_chainId", []);
    return Number(BigInt(hex as string));
  } catch {
    return null;
  }
}

/**
 * Move the wallet to the target chain. If the chain isn't in the wallet yet it
 * is added first (wallet_addEthereumChain), then switched to. Throws if the
 * user rejects the switch.
 */
export async function switchToTargetChain(): Promise<void> {
  const request = await getRequest();
  const chainIdHex = toHex(TARGET_CHAIN_ID);

  try {
    await request("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
    return;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    const msg = String((err as { message?: string })?.message ?? "");
    const chainNotAdded =
      code === 4902 || msg.includes("Unrecognized chain") || msg.includes("wallet_addEthereumChain");
    if (!chainNotAdded) throw err; // e.g. user rejected (4001)

    await request("wallet_addEthereumChain", [
      {
        chainId: chainIdHex,
        chainName: targetChain.name,
        nativeCurrency: targetChain.nativeCurrency,
        rpcUrls: [targetChain.rpcUrls.default.http[0]],
        blockExplorerUrls: targetChain.blockExplorers?.default
          ? [targetChain.blockExplorers.default.url]
          : [],
      },
    ]);
    await request("wallet_switchEthereumChain", [{ chainId: chainIdHex }]);
  }
}

/**
 * Ensure the wallet ends up on the target chain, switching (or adding) as
 * needed. Throws WrongNetworkError if it can't be reached — e.g. the user
 * rejected the switch popup.
 */
export async function ensureTargetChain(): Promise<void> {
  const account = getAccount(config);
  if (
    account.isConnected &&
    account.chainId !== undefined &&
    account.chainId !== TARGET_CHAIN_ID
  ) {
    await switchToTargetChain();
  }
  const id = await currentChainId();
  if (id !== TARGET_CHAIN_ID) throw new WrongNetworkError();
}
