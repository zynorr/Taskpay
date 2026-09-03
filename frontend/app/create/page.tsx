"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther } from "viem";
import { useAccount } from "wagmi";
import { writeContract, specHashOf } from "@/lib/tasks";
import { shortAddress } from "@/lib/format";

export default function CreateTaskPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [agent, setAgent] = useState("");
  const [specText, setSpecText] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [acceptWindow, setAcceptWindow] = useState("3600");
  const [workDuration, setWorkDuration] = useState("86400");
  const [reviewPeriod, setReviewPeriod] = useState("259200");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setTxHash(null);

    if (!agent || !/^0x[0-9a-fA-F]{40}$/.test(agent)) {
      setError("Agent must be a valid 0x address.");
      return;
    }
    if (!specText.trim()) {
      setError("Spec text is required (its keccak is anchored on-chain).");
      return;
    }
    const amountWei = parseEther(amount || "0");
    if (amountWei <= 0n) {
      setError("Escrow amount must be > 0.");
      return;
    }

    setBusy(true);
    try {
      const res = await writeContract("createTask", [
        agent,
        specHashOf(specText.trim()),
        BigInt(acceptWindow || "0"),
        BigInt(workDuration || "0"),
        BigInt(reviewPeriod || "0"),
      ], { value: amountWei });
      setTxHash(res.hash);
      // give the chain a moment, then land on the task list
      setTimeout(() => router.push("/"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Create task</h1>

      {!isConnected && (
        <div className="mb-4 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          Connect your wallet to create a task.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <label className="mb-1 block text-sm text-slate-400">Agent address</label>
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
            placeholder="0x…"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            Spec text <span className="text-slate-600">(keccak stored on-chain)</span>
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            rows={4}
            placeholder="Describe the deliverable, requirements, and acceptance criteria…"
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
          />
          {specText.trim() && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              specHash: {specHashOf(specText.trim())}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Escrow amount (BOT)</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Accept window (s)</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={acceptWindow}
              onChange={(e) => setAcceptWindow(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Work duration (s)</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={workDuration}
              onChange={(e) => setWorkDuration(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Review period (s)</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              value={reviewPeriod}
              onChange={(e) => setReviewPeriod(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300">{error}</div>
        )}
        {txHash && (
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/50 p-3 text-sm text-emerald-300">
            Task created: <span className="font-mono">{shortAddress(txHash)}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !isConnected}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create task"}
        </button>
      </form>

      <p className="mt-4 text-xs text-slate-500">
        Connected as {address ? shortAddress(address) : "—"}. Registering the spec text with the
        oracle&apos;s archive is separate (see the API routes); the on-chain anchor is the specHash
        shown above.
      </p>
    </div>
  );
}