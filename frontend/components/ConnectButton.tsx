"use client";

import { useCallback, useState } from "react";
import { useAccount, useChainId, useConnect, useDisconnect } from "wagmi";
import { shortAddress, copyText, explorerAddress } from "@/lib/format";
import { targetChain } from "@/lib/chains";
import { switchToTargetChain } from "@/lib/network";

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
        <span
          className={`chip hidden sm:inline-flex ${
            onRightChain
              ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
              : "border-amber-800/60 bg-amber-950/40 text-amber-300"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${onRightChain ? "bg-emerald-400" : "bg-amber-400"} animate-pulse-dot`}
          />
          {onRightChain ? "BOT Chain testnet" : `chain ${chainId}`}
        </span>

        <div className="flex items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-800/60">
          <button
            onClick={onCopy}
            title={copied ? "Copied!" : "Copy address"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-xs text-slate-200 transition hover:bg-slate-700/60"
          >
            {shortAddress(address)}
            <span className="text-[10px] text-slate-500">{copied ? "✓" : "⧉"}</span>
          </button>
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            title="View on explorer"
            className="border-l border-slate-700 px-2 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700/60 hover:text-white"
          >
            ↗
          </a>
        </div>

        {!onRightChain && (
          <button
            onClick={() => {
              setSwitching(true);
              switchToTargetChain()
                .catch(() => {
                  /* stays on the current chain — the guard banner offers retry */
                })
                .finally(() => setSwitching(false));
            }}
            disabled={switching}
            className="rounded-lg border border-amber-700 bg-amber-600/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-600/20 disabled:opacity-50"
          >
            {switching ? "Switching…" : "Switch to testnet"}
          </button>
        )}
        <button
          onClick={() => disconnect()}
          className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-rose-800 hover:text-rose-300"
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
      className="btn-primary !px-4 !py-2 text-sm"
    >
      {isPending ? (
        <>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Connecting…
        </>
      ) : (
        "Connect wallet"
      )}
    </button>
  );
}