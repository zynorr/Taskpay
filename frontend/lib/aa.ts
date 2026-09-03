// ERC-4337 sponsor stack (deployed on BOT Chain testnet — see DEPLOY.md).
// The oracle runs the bundler and the VerifyingPaymaster sponsor service, so
// users never pay gas: every action is a sponsored UserOp from their
// SimpleAccount. Defaults match the canonical testnet deployment; override via
// NEXT_PUBLIC_* for a fresh deploy.
import { getPublicClient } from "@wagmi/core";
import { encodeFunctionData } from "viem";
import { config } from "@/lib/wagmi";
import { CONTRACT_ADDRESS, TASKPAY_ABI } from "@/lib/contract";

export const ENTRY_POINT =
  (process.env.NEXT_PUBLIC_ENTRY_POINT as `0x${string}` | undefined) ??
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export const AA_FACTORY =
  (process.env.NEXT_PUBLIC_AA_FACTORY as `0x${string}` | undefined) ??
  "0xFbfBBD060b1d4E7Edae6D9e58C73F731927b2f2b";

export const PAYMASTER =
  (process.env.NEXT_PUBLIC_PAYMASTER as `0x${string}` | undefined) ??
  "0x8Ed5e3054A98a6528B666Ca99411648B94A0fDF0";

/** Oracle bundler base URL (the /v1/quote + /v1/send endpoints). */
export function bundlerUrl(): string | null {
  return process.env.NEXT_PUBLIC_BUNDLER_URL?.replace(/\/$/, "") ?? null;
}

const FACTORY_ABI = [
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/**
 * The SimpleAccount that acts on TaskPay for a connected EOA (salt 0 is the
 * canonical account). Deterministic CREATE2 — the address exists even before
 * the account is deployed, so it can be pre-funded and shown in the UI.
 */
export async function smartAccountOf(owner: `0x${string}`): Promise<`0x${string}`> {
  const client = getPublicClient(config);
  return client.readContract({
    address: AA_FACTORY,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [owner, 0n],
  });
}

/** Encode a TaskPay call the way the bundler expects (target + raw calldata). */
export function encodeTaskPayCall(
  functionName: string,
  args: readonly unknown[],
): `0x${string}` {
  return encodeFunctionData({
    abi: TASKPAY_ABI,
    functionName: functionName as never,
    args: args as never,
  });
}

export { CONTRACT_ADDRESS };
