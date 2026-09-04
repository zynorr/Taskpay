"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { shortAddress, copyText, explorerAddress } from "@/lib/format";
import { targetChain } from "@/lib/chains";
import { switchToTargetChain } from "@/lib/network";
import { ArrowUpRight, Check, Copy, Refresh } from "./icons";

export default function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [copied, setCopied] = useState(false);
  const [switching, setSwitching] = useState(false);

  const onCopy = useCallback(async () => {
    if (!address) return;
    const ok = await copyText(address);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [address]);

  if (isConnected && address) {
    const onRightChain = chainId === targetChain.id;
    return (
      <div className="flex items-center gap-2">
        {!onRightChain && (
          <button
            onClick={() => {
              setSwitching(true);
              switchToTargetChain()
                .catch(() => {
                  /* guard banner offers retry */
                })
                .finally(() => setSwitching(false));
            }}
            disabled={switching}
            title={`Switch to ${targetChain.name}`}
            className="hidden items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition hover:border-amber-500/50 hover:bg-amber-500/20 disabled:opacity-50 md:inline-flex"
          >
            <Refresh size={13} className={switching ? "animate-spin" : ""} />
            Wrong network
          </button>
        )}
        <div className="flex items-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
          <button
            onClick={onCopy}
            title={copied ? "Copied" : "Copy address"}
            className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs text-zinc-200 transition hover:bg-white/[0.06]"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                onRightChain ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {shortAddress(address)}
            {copied ? (
              <Check size={12} className="text-emerald-400" />
            ) : (
              <Copy size={12} className="text-zinc-600" />
            )}
          </button>
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            title="View on explorer"
            className="flex items-center border-l border-white/10 px-2 py-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <ArrowUpRight size={13} />
          </a>
        </div>
        <button
          onClick={() => disconnect()}
          className="hidden rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-500 transition hover:border-rose-500/40 hover:text-rose-300 sm:block"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        const c = connectors.find((x) => x.id === "injected") ?? connectors[0];
        if (c) connect({ connector: c });
      }}
      disabled={isPending}
      className="btn-secondary btn-sm !py-2"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
