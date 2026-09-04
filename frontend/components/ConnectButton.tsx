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
            className="hidden items-center gap-1.5 rounded-lg border border-warn-line bg-warn-soft px-2.5 py-1.5 text-xs font-medium text-warn transition hover:bg-warn-soft disabled:opacity-50 md:inline-flex"
          >
            <Refresh size={13} className={switching ? "animate-spin" : ""} />
            Wrong network
          </button>
        )}
        <div className="flex items-center overflow-hidden rounded-lg border border-line bg-subtle">
          <button
            onClick={onCopy}
            title={copied ? "Copied" : "Copy address"}
            className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs text-fg transition hover:bg-subtleH"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                onRightChain ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            {shortAddress(address)}
            {copied ? (
              <Check size={12} className="text-ok" />
            ) : (
              <Copy size={12} className="text-faint" />
            )}
          </button>
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            title="View on explorer"
            className="flex items-center border-l border-line px-2 py-1.5 text-faint transition hover:bg-subtleH hover:text-fg"
          >
            <ArrowUpRight size={13} />
          </a>
        </div>
        <button
          onClick={() => disconnect()}
          className="hidden rounded-lg border border-line px-2.5 py-1.5 text-xs text-faint transition hover:border-bad-line hover:text-bad sm:block"
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
