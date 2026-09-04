"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { TARGET_CHAIN_ID, switchToTargetChain } from "@/lib/network";
import { AlertTriangle } from "./icons";

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
        /* user rejected — the banner stays with a manual retry */
      })
      .finally(() => setBusy(false));
  }, [wrong]);

  if (!wrong) return null;

  return (
    <div className="border-b border-warn-line bg-warn-soft">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-[13px] text-warn sm:px-6">
        <p className="flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            Wallet is on chain {chainId}. TaskPay runs on BOT Chain testnet (chain{" "}
            {TARGET_CHAIN_ID}).
          </span>
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
          className="rounded-lg border border-warn-line bg-subtle px-3 py-1.5 text-xs font-medium text-fg transition hover:bg-subtleH disabled:opacity-50"
        >
          {busy ? "Switching…" : "Switch network"}
        </button>
      </div>
    </div>
  );
}
