"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { TARGET_CHAIN_ID, switchToTargetChain } from "@/lib/network";

/**
 * Full-width banner shown whenever the connected wallet is on the wrong
 * network. Auto-attempts one switch when the mismatch appears, and keeps a
 * manual retry button in case the user rejected the first popup.
 *
 * TaskPay is gasless-only: every write is a sponsored UserOp from the user's
 * smart account, so signing works from any chain. The wallet must be on BOT
 * Chain testnet (968) only to fund the TaskPay account — hence the guard.
 */
export default function ChainGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);

  const wrong = isConnected && chainId !== undefined && chainId !== TARGET_CHAIN_ID;

  useEffect(() => {
    if (!wrong || attempted.current) return;
    attempted.current = true;
    setBusy(true);
    switchToTargetChain()
      .catch(() => {
        /* user rejected — the banner stays with a manual retry button */
      })
      .finally(() => setBusy(false));
  }, [wrong]);

  if (!wrong) return null;

  return (
    <div className="border-b border-amber-800/70 bg-amber-950/50">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <p className="flex items-center gap-2 text-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          Your wallet is on chain {chainId}. TaskPay runs on{" "}
          <strong className="font-semibold">BOT Chain testnet (chain {TARGET_CHAIN_ID})</strong> —
          switch to fund your TaskPay account or verify balances.
        </p>
        <button
          onClick={() => {
            setBusy(true);
            switchToTargetChain()
              .catch(() => {
                /* stays on the banner */
              })
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="rounded-lg border border-amber-600 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy ? "Switching…" : "Switch to BOT Chain testnet"}
        </button>
      </div>
    </div>
  );
}
