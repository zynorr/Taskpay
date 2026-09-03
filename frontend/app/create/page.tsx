"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther, formatEther } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { writeContract, writeGasless, specHashOf, myIdentity } from "@/lib/tasks";
import { smartAccountOf, bundlerUrl } from "@/lib/aa";
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
  const [gasless, setGasless] = useState(false);
  const [smart, setSmart] = useState<string | null>(null);
  const [smartBalance, setSmartBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const canGasless = Boolean(bundlerUrl()) && isConnected;

  // Load the connected EOA's smart account (its on-chain TaskPay identity).
  useEffect(() => {
    let alive = true;
    if (!isConnected || !address) {
      setSmart(null);
      return;
    }
    if (canGasless) setGasless(true);
    myIdentity()
      .then(({ smart: s }) => {
        if (!alive) return;
        setSmart(s);
        return s;
      })
      .then((s) => {
        if (!alive || !s) return;
        import("@wagmi/core").then(async ({ getPublicClient }) => {
          const { config } = await import("@/lib/wagmi");
          const bal = (await getPublicClient(config).getBalance({ address: s as `0x${string}` })) as bigint;
          if (alive) setSmartBalance(bal);
        });
      })
      .catch(() => alive && setSmart(null));
    return () => {
      alive = false;
    };
  }, [isConnected, address, canGasless]);

  // One-time top-up: EOA → smart account so the sponsored createTask has escrow.
  const { sendTransactionAsync } = useSendTransaction();
  const [fundTx, setFundTx] = useState<`0x${string}` | null>(null);
  const { data: fundReceipt } = useWaitForTransactionReceipt({ hash: fundTx ?? undefined });
  useEffect(() => {
    if (fundReceipt?.status === "success" && smart) {
      import("@wagmi/core").then(async ({ getPublicClient }) => {
        const { config } = await import("@/lib/wagmi");
        const bal = (await getPublicClient(config).getBalance({ address: smart as `0x${string}` })) as bigint;
        setSmartBalance(bal);
        setFundTx(null);
      });
    }
  }, [fundReceipt, smart]);

  async function topUp(amountWei: bigint) {
    if (!smart) return;
    setError(null);
    try {
      // fund escrow + a small buffer (dust stays in the account for future ops)
      const value = amountWei + parseEther("0.005");
      setFundTx(await sendTransactionAsync({ to: smart as `0x${string}`, value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

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

    const args = [
      agent,
      specHashOf(specText.trim()),
      BigInt(acceptWindow || "0"),
      BigInt(workDuration || "0"),
      BigInt(reviewPeriod || "0"),
    ] as const;

    setBusy(true);
    try {
      if (gasless && smart) {
        if (smartBalance === null || smartBalance < amountWei) {
          setError(
            `Your TaskPay account (${shortAddress(smart)}) holds ${smartBalance === null ? "…" : formatEther(smartBalance)} BOT — fund it first (one deposit, then every action is gasless).`,
          );
          return;
        }
        const res = await writeGasless("createTask", args, { value: amountWei });
        setTxHash(res.hash);
      } else {
        const res = await writeContract("createTask", args, { value: amountWei });
        setTxHash(res.hash);
      }
      setTimeout(() => router.push("/"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const amountWei = (() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  })();

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Create task</h1>

      {!isConnected && (
        <div className="mb-4 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          Connect your wallet to create a task.
        </div>
      )}

      {canGasless && (
        <div className="mb-4 rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-emerald-200">
            <input
              type="checkbox"
              checked={gasless}
              onChange={(e) => setGasless(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span>
              <strong>Gasless (sponsored)</strong> — the TaskPay oracle pays your gas via ERC-4337
            </span>
          </label>
          {gasless && smart && (
            <div className="mt-3 space-y-2 text-xs text-emerald-300/80">
              <p>
                Your on-chain identity will be your smart account:{" "}
                <span className="font-mono">{shortAddress(smart)}</span>
              </p>
              <p>
                Balance: <span className="font-mono">{smartBalance === null ? "…" : `${formatEther(smartBalance)} BOT`}</span>
                {smartBalance !== null && smartBalance < amountWei && (
                  <button
                    type="button"
                    disabled={!!fundTx}
                    onClick={() => topUp(amountWei)}
                    className="ml-2 rounded bg-emerald-700 px-2 py-0.5 font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {fundTx ? "Funding…" : "Fund account"}
                  </button>
                )}
              </p>
              <p className="text-emerald-500/60">
                Fund once (one normal transaction from your wallet); every TaskPay action afterwards — create,
                accept, submit, release, dispute — costs you 0 gas.
              </p>
            </div>
          )}
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
          {gasless && agent.trim() && (
            <AgentSmartHint agent={agent} />
          )}
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
            {gasless && <span className="ml-2 text-emerald-400">⚡ gasless — 0 gas paid</span>}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !isConnected}
          className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating…" : gasless && smart ? "Create task ⚡ gasless" : "Create task"}
        </button>
      </form>

      <p className="mt-4 text-xs text-slate-500">
        Connected as {address ? shortAddress(address) : "—"}
        {gasless && smart ? ` (gasless identity ${shortAddress(smart)})` : ""}. Registering the spec text with the
        oracle&apos;s archive is separate (see the API routes); the on-chain anchor is the specHash shown above.
      </p>
    </div>
  );
}

/** Shows the agent's counterfactual smart account, so the user can paste that
 *  address to make the agent side gasless too. */
function AgentSmartHint({ agent }: { agent: string }) {
  const [smart, setSmart] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) return;
    try {
      setSmart(await smartAccountOf(agent as `0x${string}`));
    } catch {
      setSmart(null);
    }
  }, [agent]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!smart) return null;
  return (
    <p className="mt-1 text-[11px] text-slate-500">
      Agent&apos;s gasless account: <span className="font-mono">{smart}</span> — paste this into the field above to
      let the agent also act with sponsored gas.
    </p>
  );
}
