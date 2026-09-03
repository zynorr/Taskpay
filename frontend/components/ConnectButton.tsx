"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortAddress } from "@/lib/format";

export default function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-900/60 px-3 py-1 font-mono text-xs text-emerald-300">
          {shortAddress(address)}
        </span>
        <button
          onClick={() => disconnect()}
          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
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
      className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}