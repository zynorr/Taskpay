"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther, formatEther } from "viem";
import { useAccount } from "wagmi";
import { writeGasless, specHashOf, myIdentity, fetchTaskCount, fetchAgentRating } from "@/lib/tasks";
import { smartAccountOf, bundlerUrl } from "@/lib/aa";
import {
  shortAddress,
  shortHash,
  explorerTx,
  explorerAddress,
  copyText,
  formatDurationLabel,
} from "@/lib/format";

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
  const [smart, setSmart] = useState<string | null>(null);
  const [smartBalance, setSmartBalance] = useState<bigint | null>(null);
  // An account is "used" once it has been deployed on-chain (its first UserOp).
  // Before that, external deposits sit at a code-less address — worth telling
  // the user this is expected and that the first action deploys it.
  const [smartUsed, setSmartUsed] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ taskId: number; hash: string } | null>(null);

  const bundlerOnline = Boolean(bundlerUrl());

  const agentValid = /^0x[0-9a-fA-F]{40}$/.test(agent);
  const amountWei = useMemo(() => {
    try {
      return parseEther(amount || "0");
    } catch {
      return 0n;
    }
  }, [amount]);
  const amountValid = amountWei > 0n;

  const refreshAccount = useCallback(async (smartAddr: string) => {
    try {
      const [{ getPublicClient }, { config }] = await Promise.all([
        import("@wagmi/core"),
        import("@/lib/wagmi"),
      ]);
      const client = getPublicClient(config);
      const [bal, code] = await Promise.all([
        client.getBalance({ address: smartAddr as `0x${string}` }),
        client.getCode({ address: smartAddr as `0x${string}` }),
      ]);
      setSmartBalance(bal as bigint);
      setSmartUsed((code?.length ?? 0) > 0);
    } catch {
      /* keep the last known state */
    }
  }, []);

  // Load the connected EOA's TaskPay account (its smart account) + balance.
  useEffect(() => {
    let alive = true;
    if (!isConnected || !address) {
      setSmart(null);
      setSmartBalance(null);
      return;
    }
    myIdentity()
      .then(async ({ smart: s }) => {
        if (!alive) return;
        setSmart(s);
        if (s) await refreshAccount(s);
      })
      .catch(() => alive && setSmart(null));
    return () => {
      alive = false;
    };
  }, [isConnected, address, refreshAccount]);

  // While the account is short of escrow, watch for the external deposit
  // (the app never signs a funding transaction — it arrives from the wallet).
  useEffect(() => {
    if (!smart || smartBalance === null || smartBalance >= amountWei) return;
    const t = setInterval(() => refreshAccount(smart), 4000);
    return () => clearInterval(t);
  }, [smart, smartBalance, amountWei, refreshAccount]);

  const underfunded = smart !== null && smartBalance !== null && smartBalance < amountWei;
  const missing = smartBalance === null ? null : amountWei - smartBalance;

  async function onCopy() {
    if (!smart) return;
    const ok = await copyText(smart);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
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
    if (smartBalance === null || smartBalance < amountWei) {
      setError(
        `Your TaskPay account holds ${
          smartBalance === null ? "…" : `${formatEther(smartBalance)} BOT`
        } — fund it with at least ${amount} BOT to escrow this task.`,
      );
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
      // Gasless-only: the TaskPay account performs the create through the
      // oracle's sponsored bundler. The user signs one UserOp hash — no wallet
      // transaction is ever broadcast from this app.
      const res = await writeGasless("createTask", args, { value: amountWei });
      const count = await fetchTaskCount();
      setCreated({ taskId: count - 1, hash: res.hash });
      // The account is now deployed/used — reflect it (and the spent escrow).
      if (smart) void refreshAccount(smart);
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
          quorum, appeals by a Senior Arbiter. Every action is sponsored: you sign, never pay gas.
        </p>
      </div>

      {!bundlerOnline && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-300">
          The sponsor bundler isn&apos;t reachable, and TaskPay is gasless-only — posting tasks is
          unavailable until the oracle is running.
        </div>
      )}

      {!isConnected && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm text-amber-300">
          Connect your wallet to post a task.
        </div>
      )}

      {isConnected && bundlerOnline && (
        <div className="rounded-2xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-emerald-200">
            <span className="font-semibold">Your TaskPay account</span>
            <span className="font-mono">{smart ? shortAddress(smart) : "…"}</span>
            {smart && (
              <span className="flex items-center gap-1">
                <button
                  onClick={onCopy}
                  className="rounded border border-emerald-800/60 px-1.5 py-0.5 text-[10px] text-emerald-300 transition hover:bg-emerald-900/40"
                >
                  {copied ? "✓ copied" : "copy"}
                </button>
                <a
                  href={explorerAddress(smart)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded border border-emerald-800/60 px-1.5 py-0.5 text-[10px] text-emerald-300 transition hover:bg-emerald-900/40"
                >
                  view ↗
                </a>
              </span>
            )}
            <span className="chip border-emerald-800/50 bg-emerald-950/40 text-emerald-300">
              balance {smartBalance === null ? "…" : `${formatEther(smartBalance)} BOT`}
            </span>
          </p>

          {smartBalance !== null && smartBalance > 0n && smartUsed === false && smart && (
            <div className="mt-3 rounded-xl border border-cyan-900/50 bg-cyan-950/20 p-3 text-xs text-cyan-200">
              <p className="font-medium text-cyan-100">
                Funded — not activated yet
              </p>
              <p className="mt-1 leading-relaxed text-cyan-300/80">
                {formatEther(smartBalance)} BOT is on{" "}
                <span className="font-mono">{shortAddress(smart)}</span>, which has no code on-chain
                yet. That&apos;s expected: TaskPay accounts are deployed by your first gasless action,
                in the same transaction. The deposit is safe — only your wallet can activate and
                spend this account.
              </p>
            </div>
          )}

          {smartBalance !== null && underfunded ? (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="font-medium text-amber-100">
                Fund your TaskPay account to escrow this task
              </p>
              <p className="text-amber-300/80">
                TaskPay never broadcasts transactions from your wallet — escrow is spent from your
                TaskPay account. Send at least{" "}
                <span className="font-mono font-semibold text-amber-100">
                  {formatEther(missing ?? 0n)} BOT
                </span>{" "}
                from your wallet on <strong>BOT Chain testnet (968)</strong> to:
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-amber-800/70 bg-black/30 px-2.5 py-1.5 font-mono text-amber-100">
                  {smart}
                </span>
                <button
                  onClick={onCopy}
                  className="rounded-md bg-amber-700/80 px-2.5 py-1.5 font-medium text-amber-50 transition hover:bg-amber-600 disabled:opacity-50"
                >
                  {copied ? "✓ Copied" : "Copy address"}
                </button>
                <a
                  href={explorerAddress(smart)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-amber-800/60 px-2.5 py-1.5 text-amber-300 transition hover:bg-amber-900/40"
                >
                  view on explorer ↗
                </a>
              </p>
              <p className="text-amber-400/70">
                Switch your wallet to BOT Chain testnet first (button in the header if needed).
                Balance refreshes automatically when the deposit lands.
              </p>
            </div>
          ) : (
            smartBalance !== null &&
            smartBalance >= amountWei &&
            smartUsed === true && (
              <p className="mt-2 text-xs text-emerald-400/80">
                ✓ Funded — escrow will come from this account. Your one-time top-up was done
                outside the app; every TaskPay action here is sponsored.
              </p>
            )
          )}
        </div>
      )}

      {isConnected && bundlerOnline && (
        <form onSubmit={onSubmit} className="card space-y-5 p-6">
          {/* Agent */}
          <div>
            <label className="label">Agent TaskPay account</label>
            <input
              className={`input font-mono ${agent && !agentValid ? "!border-rose-800 focus:!border-rose-500 focus:!ring-rose-500/50" : ""}`}
              placeholder="0x… (the agent's TaskPay account address)"
              value={agent}
              onChange={(e) => setAgent(e.target.value)}
            />
            {agent && !agentValid && (
              <p className="mt-1.5 text-xs text-rose-400">
                That doesn&apos;t look like a valid address (0x + 40 hex chars).
              </p>
            )}
            {agentValid && (
              <AgentCheck agent={agent.trim() as `0x${string}`} onUse={setAgent} />
            )}
            <p className="mt-1.5 text-[11px] text-slate-600">
              The agent acts gasless from its TaskPay account — if you only know the agent&apos;s
              wallet, paste it below and use the suggested account address.
            </p>
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
                  agent{" "}
                  <span className="font-mono text-slate-300">
                    {agentValid ? shortAddress(agent.trim()) : "…"}
                  </span>
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
              <p className="font-semibold">✓ Task #{created.taskId} created ⚡ gasless — you paid 0 gas</p>
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
            disabled={busy || !isConnected || underfunded || smartBalance === null}
            className="btn-primary w-full !py-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creating task…
              </>
            ) : underfunded ? (
              `Fund ${formatEther(missing ?? 0n)} BOT to create`
            ) : (
              "Create task ⚡ gasless"
            )}
          </button>
          {underfunded && (
            <p className="text-center text-[11px] text-slate-600">
              Creation unlocks as soon as your TaskPay account holds the escrow — no wallet
              transaction from this app, ever.
            </p>
          )}
        </form>
      )}

      <p className="text-center text-[11px] text-slate-600">
        The spec text is registered with the TaskPay archive automatically so the AI reviewers can
        read what was asked.
      </p>
    </div>
  );
}

const OWNER_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Soft pre-flight on the pasted agent address, before any escrow is locked:
 *  - deployed address → read owner() to confirm it really is a TaskPay account
 *    (and cross-check it against TaskPay's factory); a contract with no owner()
 *    can never accept, so warn loudly
 *  - plain wallet (no code) → show its deterministic TaskPay account, since
 *    only that account can act with sponsored gas
 *  - show the agent's on-chain rating summary for whoever is in the field */
function AgentCheck({ agent, onUse }: { agent: `0x${string}`; onUse: (sa: string) => void }) {
  const [info, setInfo] = useState<null | {
    smart: string;
    hasCode: boolean;
    owner: string | null;
    fromFactory: boolean;
  }>(null);
  const [rating, setRating] = useState<{ totalScore: bigint; count: bigint } | null>(null);
  const [ratingLoaded, setRatingLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const sa = await smartAccountOf(agent);
      const { getPublicClient } = await import("@wagmi/core");
      const { config } = await import("@/lib/wagmi");
      const client = getPublicClient(config);
      const code = await client.getCode({ address: agent });
      const hasCode = (code?.length ?? 0) > 0;
      let owner: string | null = null;
      let fromFactory = false;
      if (hasCode) {
        try {
          owner = (await client.readContract({
            address: agent,
            abi: OWNER_ABI,
            functionName: "owner",
          })) as string;
          if (owner) {
            fromFactory =
              (await smartAccountOf(owner as `0x${string}`)).toLowerCase() === agent.toLowerCase();
          }
        } catch {
          owner = null; // has code but no owner() → not a TaskPay account
        }
      }
      setInfo({ smart: sa, hasCode, owner, fromFactory });
    } catch {
      setInfo(null);
    }
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    setRating(null);
    setRatingLoaded(false);
    fetchAgentRating(agent)
      .then((r) => alive && setRating(r))
      .catch(() => {
        /* unreadable → no reputation shown */
      })
      .finally(() => alive && setRatingLoaded(true));
    return () => {
      alive = false;
    };
  }, [agent]);

  if (!info) return null;

  let accountLine: React.ReactNode = null;
  if (info.hasCode && info.owner === null) {
    // code, no owner() → some random contract that can never act as an agent
    accountLine = (
      <div className="mt-2 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-[11px] text-rose-300">
        This address has code but is <strong>not a TaskPay account</strong> (no owner()) — it can
        never accept the task. Creating anyway locks the escrow until you cancel or reclaim.
      </div>
    );
  } else if (info.hasCode && info.owner) {
    // deployed account: show who owns it, ideally verified against TaskPay's factory
    accountLine = (
      <p className="mt-1.5 text-[11px]">
        {info.fromFactory ? (
          <span className="text-emerald-400/80">
            ✓ Verified TaskPay account — owned by{" "}
            <a
              href={explorerAddress(info.owner)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-emerald-300 underline-offset-2 hover:underline"
            >
              {shortAddress(info.owner)}
            </a>
            , derived from TaskPay&apos;s account factory
          </span>
        ) : (
          <span className="text-amber-400/80">
            Contract with an owner({" "}
            <a
              href={explorerAddress(info.owner)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-amber-300 underline-offset-2 hover:underline"
            >
              {shortAddress(info.owner)}
            </a>
            ) but not TaskPay&apos;s standard account for that owner — confirm this is the account you
            intend to hire.
          </span>
        )}
      </p>
    );
  } else {
    // plain wallet (no code): acts on-chain as its deterministic TaskPay account
    accountLine = (
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-brand-900/50 bg-brand-950/20 px-3 py-2 text-[11px] text-slate-400">
        <span>
          This is a plain wallet (no code) — it acts on TaskPay as its account{" "}
          <span className="font-mono text-brand-200">{info.smart}</span>, deployed by its first
          action. Paste the account address instead so the agent can act with sponsored gas.
        </span>
        <button
          type="button"
          onClick={() => onUse(info.smart)}
          className="rounded-md bg-brand-700 px-2 py-1 font-medium text-white transition hover:bg-brand-600"
        >
          Use this account
        </button>
      </div>
    );
  }

  const ratingLine =
    ratingLoaded && rating && rating.count > 0n ? (
      <p className="mt-1.5 text-[11px] text-slate-500">
        <span className="text-amber-400">★</span>{" "}
        {(Number(rating.totalScore) / Number(rating.count)).toFixed(1)}{" "}
        <span className="text-slate-600">· {rating.count.toString()} on-chain rating{rating.count === 1n ? "" : "s"}</span>
      </p>
    ) : ratingLoaded ? (
      <p className="mt-1 text-[11px] text-slate-600">no on-chain ratings yet — first task sets the record</p>
    ) : null;

  return (
    <>
      {accountLine}
      {ratingLine}
    </>
  );
}
