"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther, formatEther } from "viem";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import {
  writeContract,
  writeGasless,
  specHashOf,
  myIdentity,
  fetchTaskCount,
} from "@/lib/tasks";
import { smartAccountOf, bundlerUrl } from "@/lib/aa";
import { shortAddress, shortHash, explorerTx } from "@/lib/format";
import { formatDurationLabel } from "@/lib/format";

const ACCEPT_OPTIONS = [600, 3600, 21600, 86400];
const WORK_OPTIONS = [3600, 21600, 86400, 259200, 604800];
const REVIEW_OPTIONS = [3600, 86400, 259200, 604800];
const AMOUNT_CHIPS = ["0.01", "0.05", "0.1", "0.5"];

function DurationSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: number[];
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {formatDurationLabel(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

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
  const [created, setCreated] = useState<{ taskId: number; hash: string; gasless: boolean } | null>(null);

  const canGasless = Boolean(bundlerUrl()) && isConnected;

  const agentValid = /^0x[0-9a-fA-F]{40}$/.test(agent);
  const amountWei = useMemo(() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);
  const amountValid = amountWei > 0n;

  // Load the connected EOA's smart account (its on-chain TaskPay identity).
  useEffect(() => {
    let alive = true;
    if (!isConnected || !address) {
      setSmart(null);
      setSmartBalance(null);
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
      const value = amountWei + parseEther("0.005");
      setFundTx(await sendTransactionAsync({ to: smart as `0x${string}`, value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);

    if (!agentValid) {
      setError("Enter a valid 0x agent address.");
      return;
    }
    if (!specText.trim()) {
      setError("Describe the task — its keccak hash is anchored on-chain.");
      return;
    }
    if (!amountValid) {
      setError("Escrow amount must be greater than 0.");
      return;
    }

    const args = [
      agent.trim(),
      specHashOf(specText.trim()),
      BigInt(acceptWindow),
      BigInt(workDuration),
      BigInt(reviewPeriod),
    ] as const;

    setBusy(true);
    try {
      if (gasless && smart) {
        if (smartBalance === null || smartBalance < amountWei) {
          setError(
            `Your TaskPay account (${shortAddress(smart)}) holds ${
              smartBalance === null ? "…" : `${formatEther(smartBalance)} BOT`
            } — fund it once, then every action is gasless.`,
          );
          return;
        }
        const res = await writeGasless("createTask", args, { value: amountWei });
        const count = await fetchTaskCount();
        setCreated({ taskId: count - 1, hash: res.hash, gasless: true });
      } else {
        const res = await writeContract("createTask", args, { value: amountWei });
        const count = await fetchTaskCount();
        setCreated({ taskId: count - 1, hash: res.hash, gasless: false });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Register the spec text with the oracle archive once the task exists, so the
  // detail page (and the dispute agents) can show what was actually asked.
  useEffect(() => {
    if (!created) return;
    fetch(`/api/specs/${created.taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec_text: specText.trim(), spec_hash: specHashOf(specText.trim()) }),
    }).catch(() => {
      /* best-effort; the on-chain hash is the anchor */
    });
  }, [created, specText]);

  return (
    <div className="animate-fade-in mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Post a task</h1>
        <p className="mt-1 text-sm text-slate-400">
          Fund an escrow, name an agent, and let settlement run itself — disputes ruled by the AI
          quorum, appeals by a Senior Arbiter.
        </p>
      </div>

      {!isConnected && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-300">
          Connect your wallet to post a task.
        </div>
      )}

      {canGasless && (
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-emerald-200">
            <input
              type="checkbox"
              checked={gasless}
              onChange={(e) => setGasless(e.target.checked)}
              className="h-4 w-4 rounded accent-emerald-500"
            />
            <span>
              <strong>Gasless (sponsored)</strong> — the TaskPay oracle pays gas via ERC-4337
            </span>
          </label>
          {gasless && smart && (
            <div className="mt-3 space-y-2 text-xs text-emerald-300/80">
              <p className="flex flex-wrap items-center gap-2">
                Your on-chain identity is your smart account:
                <span className="font-mono">{shortAddress(smart)}</span>
                <span className="chip border-emerald-800/50 bg-emerald-950/40 text-emerald-300">
                  balance {smartBalance === null ? "…" : `${formatEther(smartBalance)} BOT`}
                </span>
                {smartBalance !== null && smartBalance < amountWei && (
                  <button
                    type="button"
                    disabled={!!fundTx}
                    onClick={() => topUp(amountWei)}
                    className="rounded-md bg-emerald-700 px-2.5 py-1 font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
                  >
                    {fundTx ? "Funding…" : "Fund account"}
                  </button>
                )}
              </p>
              <p className="text-emerald-500/70">
                Fund once with one normal transaction — every TaskPay action after (create, accept,
                submit, release, dispute) costs you 0 gas.
              </p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={onSubmit} className="card space-y-5 p-6">
        {/* Agent */}
        <div>
          <label className="label">Agent address</label>
          <input
            className={`input font-mono ${agent && !agentValid ? "!border-rose-800 focus:!border-rose-500 focus:!ring-rose-500/50" : ""}`}
            placeholder="0x… (the wallet or smart account that will do the work)"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
          />
          {agent && !agentValid && (
            <p className="mt-1.5 text-xs text-rose-400">That doesn&apos;t look like a valid address (0x + 40 hex chars).</p>
          )}
          {gasless && agentValid && (
            <AgentSmartHint agent={agent.trim() as `0x${string}`} />
          )}
        </div>

        {/* Spec */}
        <div>
          <label className="label">
            Task spec <span className="normal-case text-slate-600">(anchored on-chain as a hash)</span>
          </label>
          <textarea
            className="input"
            rows={4}
            placeholder="Describe the deliverable, requirements, and acceptance criteria…"
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
          />
          {specText.trim() && (
            <p className="mt-1.5 font-mono text-[11px] text-slate-600">
              specHash <span className="text-slate-500">{shortHash(specHashOf(specText.trim()))}</span>
            </p>
          )}
        </div>

        {/* Escrow */}
        <div>
          <label className="label">Escrow amount</label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <input
                className="input !w-40 font-mono"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                BOT
              </span>
            </div>
            <div className="flex gap-1.5">
              {AMOUNT_CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAmount(c)}
                  className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
                    amount === c
                      ? "border-brand-600 bg-brand-600/20 text-brand-200"
                      : "border-slate-700 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          {amount && !amountValid && (
            <p className="mt-1.5 text-xs text-rose-400">Escrow must be greater than 0 BOT.</p>
          )}
        </div>

        {/* Windows */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <DurationSelect
            label="Accept window"
            value={acceptWindow}
            onChange={setAcceptWindow}
            options={ACCEPT_OPTIONS}
          />
          <DurationSelect
            label="Work duration"
            value={workDuration}
            onChange={setWorkDuration}
            options={WORK_OPTIONS}
          />
          <DurationSelect
            label="Review period"
            value={reviewPeriod}
            onChange={setReviewPeriod}
            options={REVIEW_OPTIONS}
          />
        </div>

        {/* Preview */}
        {(specText.trim() || agentValid) && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs">
            <div className="mb-2 font-semibold uppercase tracking-wide text-slate-500">
              Preview
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-400">
              <span>
                agent <span className="font-mono text-slate-300">{agentValid ? shortAddress(agent.trim()) : "…"}</span>
              </span>
              <span>
                escrow{" "}
                <span className="font-mono text-slate-300">
                  {amountValid ? `${formatEther(amountWei)} BOT` : "…"}
                </span>
              </span>
              <span>
                accept in <span className="text-slate-300">{formatDurationLabel(Number(acceptWindow))}</span>
              </span>
              <span>
                work for <span className="text-slate-300">{formatDurationLabel(Number(workDuration))}</span>
              </span>
              <span>
                review for <span className="text-slate-300">{formatDurationLabel(Number(reviewPeriod))}</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
            {error}
          </div>
        )}

        {created && (
          <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-300">
            <p className="font-semibold">
              ✓ Task #{created.taskId} created{created.gasless && " ⚡ gasless — you paid 0 gas"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button
                onClick={() => router.push(`/task/${created.taskId}`)}
                className="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white transition hover:bg-emerald-600"
              >
                View task →
              </button>
              <a
                href={explorerTx(created.hash)}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-200 underline-offset-2 hover:underline"
              >
                view transaction ↗
              </a>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !isConnected}
          className="btn-primary w-full !py-3 text-sm"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Creating task…
            </>
          ) : gasless && smart ? (
            "Create task ⚡ gasless"
          ) : (
            "Create task"
          )}
        </button>
      </form>

      <p className="text-center text-[11px] text-slate-600">
        The spec text is registered with the TaskPay archive automatically so the AI reviewers can
        read what was asked.
      </p>
    </div>
  );
}

/** Shows the agent's counterfactual smart account, so the user can paste that
 *  address to make the agent side gasless too. */
function AgentSmartHint({ agent }: { agent: `0x${string}` }) {
  const [smart, setSmart] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSmart(await smartAccountOf(agent));
    } catch {
      setSmart(null);
    }
  }, [agent]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!smart) return null;
  return (
    <p className="mt-1.5 text-[11px] text-slate-500">
      That agent&apos;s gasless account: <span className="font-mono text-slate-400">{smart}</span> — paste
      this instead to let the agent also act with sponsored gas.
    </p>
  );
}