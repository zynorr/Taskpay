"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseEther, formatEther } from "viem";
import { useAccount } from "wagmi";
import {
  writeGasless,
  specHashOf,
  myIdentity,
  fetchTaskCount,
  fetchAgentRating,
  fetchTaskHistory,
  fetchAgentCompletedCount,
  fetchDisputedTaskIds,
} from "@/lib/tasks";
import { smartAccountOf, bundlerUrl } from "@/lib/aa";
import {
  shortAddress,
  shortHash,
  explorerTx,
  explorerAddress,
  copyText,
  formatDurationLabel,
} from "@/lib/format";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bolt,
  Check,
  Copy,
  Info,
  Scale,
  Star,
  Wallet,
} from "@/components/icons";

const ACCEPT_OPTIONS = [600, 3600, 21600, 86400];
const WORK_OPTIONS = [3600, 21600, 86400, 259200, 604800];
const REVIEW_OPTIONS = [3600, 86400, 259200, 604800];
const AMOUNT_CHIPS = ["0.01", "0.05", "0.1", "0.5"];

function DurationSelect({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint: string;
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
      <p className="mt-1 text-[11px] leading-relaxed text-faint">{hint}</p>
    </div>
  );
}

function SectionTitle({ step, children }: { step: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[11px] font-semibold text-accent">{step}</span>
      <h2 className="text-[13px] font-semibold tracking-wide text-fg">{children}</h2>
      <span className="h-px flex-1 bg-lineSoft" />
    </div>
  );
}

export default function CreateTaskPage() {
  const { address, isConnected } = useAccount();
  const router = useRouter();

  const [agent, setAgent] = useState("");
  const [taskName, setTaskName] = useState("");
  const [specText, setSpecText] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [acceptWindow, setAcceptWindow] = useState("3600");
  const [workDuration, setWorkDuration] = useState("86400");
  const [reviewPeriod, setReviewPeriod] = useState("259200");
  const [smart, setSmart] = useState<string | null>(null);
  const [smartBalance, setSmartBalance] = useState<bigint | null>(null);
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

  // While short of escrow, watch for the external deposit arriving in-wallet.
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
    if (!taskName.trim()) {
      setError("Give the task a short name — it is shown across the marketplace.");
      return;
    }
    if (!specText.trim()) {
      setError("Describe the task — its hash is anchored on-chain.");
      return;
    }
    if (!amountValid) {
      setError("Escrow amount must be greater than 0.");
      return;
    }
    if (smartBalance === null || smartBalance < amountWei) {
      setError(
        `Your account holds ${
          smartBalance === null ? "an unknown balance" : `${formatEther(smartBalance)} BOT`
        }. Fund it with at least ${amount} BOT to escrow this task.`,
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
      const res = await writeGasless("createTask", args, { value: amountWei });
      const count = await fetchTaskCount();
      setCreated({ taskId: count - 1, hash: res.hash });
      setTaskName("");
      setSpecText("");
      setAgent("");
      if (smart) void refreshAccount(smart);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Register the spec text with the archive so the detail page and the dispute
  // agents can read what was asked.
  useEffect(() => {
    if (!created) return;
    fetch(`/api/specs/${created.taskId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: taskName.trim(),
        spec_text: specText.trim(),
        spec_hash: specHashOf(specText.trim()),
      }),
    }).catch(() => {
      /* best-effort; the on-chain hash is the anchor */
    });
  }, [created, specText]);

  const connectedReady = isConnected && bundlerOnline;

  return (
    <div className="animate-fade-up mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Post a task</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-mute">
          Lock the payment, name the agent, and let settlement run itself. Disputes are ruled by an
          AI quorum with a Senior Arbiter on appeal.
        </p>
      </div>

      {!bundlerOnline && (
        <div className="banner-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            The sponsor bundler is unreachable, and TaskPay is gasless-only. Posting is paused
            until the oracle is running.
          </span>
        </div>
      )}

      {!isConnected && (
        <div className="banner-neutral">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>Connect your wallet to post a task. You will only ever be asked to sign.</span>
        </div>
      )}

      {/* Account status */}
      {connectedReady && smart && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Wallet size={16} className="text-accent" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg">Your TaskPay account</div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs text-mute">{smart}</span>
                <button
                  onClick={onCopy}
                  title="Copy address"
                  className="rounded p-1 text-faint transition hover:bg-subtleH hover:text-fg"
                >
                  {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                </button>
                <a
                  href={explorerAddress(smart)}
                  target="_blank"
                  rel="noreferrer"
                  title="View on explorer"
                  className="rounded p-1 text-faint transition hover:bg-subtleH hover:text-fg"
                >
                  <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
            <span className="chip ml-auto tnum">
              {smartBalance === null ? "—" : `${formatEther(smartBalance)} BOT`}
            </span>
          </div>

          {smartBalance !== null && smartBalance > 0n && smartUsed === false && (
            <div className="banner-info mt-4 !text-[13px]">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span className="leading-relaxed">
                <strong className="font-medium">Account funded, not yet activated.</strong>{" "}
                {formatEther(smartBalance)} BOT sits at an address with no code — expected, since
                accounts deploy on first use. Your first action activates it in the same
                transaction; only your wallet can spend these funds.
              </span>
            </div>
          )}

          {underfunded && (
            <div className="mt-4 rounded-lg border border-warn-line bg-warn-soft px-3.5 py-3">
              <p className="text-[13px] font-medium text-fg">Fund this account to escrow the task</p>
              <p className="mt-1 text-[13px] leading-relaxed text-mute">
                TaskPay never broadcasts transactions from your wallet — escrow is spent from this
                account. Send at least{" "}
                <span className="font-mono font-semibold text-warn tnum">
                  {formatEther(missing ?? 0n)} BOT
                </span>{" "}
                to the address above from your wallet on BOT Chain testnet (968). The page unlocks
                automatically once the deposit lands.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button onClick={onCopy} className="btn-secondary btn-sm">
                  {copied ? (
                    <>
                      <Check size={13} /> Copied
                    </>
                  ) : (
                    <>
                      <Copy size={13} /> Copy address
                    </>
                  )}
                </button>
                <a
                  href={explorerAddress(smart)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-sm"
                >
                  View on explorer <ArrowUpRight size={13} />
                </a>
              </div>
            </div>
          )}

          {!underfunded && smartBalance !== null && smartBalance >= amountWei && smartUsed && (
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ok">
              <Check size={14} /> Account funded — escrow will come from here. Every action is
              sponsored, so this is the only step that moves funds.
            </p>
          )}
        </section>
      )}

      {connectedReady && (
        <form onSubmit={onSubmit} className="panel space-y-8 p-5 sm:p-6">
          {/* Agent */}
          <section className="space-y-3">
            <SectionTitle step="01">Agent</SectionTitle>
            <div>
              <label className="label">TaskPay account address</label>
              <input
                className={`input font-mono ${agent && !agentValid ? "!border-bad-line" : ""}`}
                placeholder="0x…"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                spellCheck={false}
              />
              <p className="mt-1.5 text-[11px] text-faint">
                The agent acts with sponsored gas from its TaskPay account. Paste its wallet address
                below and use the suggested account, or paste an account address directly.
              </p>
              {agent && !agentValid && (
                <p className="mt-1.5 text-xs text-bad">
                  That does not look like a valid address (0x + 40 hex characters).
                </p>
              )}
              {agentValid && <AgentCheck agent={agent.trim() as `0x${string}`} onUse={setAgent} />}
            </div>
          </section>

          {/* Spec */}
          <section className="space-y-3">
            <SectionTitle step="02">Task spec</SectionTitle>
            <div>
              <label className="label">Task name</label>
              <input
                className="input"
                placeholder="e.g. Fibonacci CLI in Python"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                maxLength={80}
              />
              <p className="mt-1.5 text-[11px] text-faint">
                A short name for the marketplace — this is what agents and reviewers will see first.
              </p>
            </div>
            <div>
              <label className="label">Deliverable &amp; requirements</label>
              <textarea
                className="input"
                rows={4}
                placeholder="Describe the deliverable, requirements, and acceptance criteria. This text is hashed on-chain and stored with the archive so reviewers can read it."
                value={specText}
                onChange={(e) => setSpecText(e.target.value)}
              />
              {specText.trim() && (
                <p className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-faint">
                  spec hash
                  <span className="text-mute">{shortHash(specHashOf(specText.trim()))}</span>
                </p>
              )}
            </div>
          </section>

          {/* Terms */}
          <section className="space-y-3">
            <SectionTitle step="03">Payment &amp; deadlines</SectionTitle>
            <div>
              <label className="label">Escrow amount</label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <input
                    className="input !w-44 font-mono tnum"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-faint">BOT</span>
                </div>
                <div className="flex gap-1.5">
                  {AMOUNT_CHIPS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAmount(c)}
                      className={`rounded-lg border px-2.5 py-1.5 font-mono text-xs transition tnum ${
                        amount === c
                          ? "border-accent-line bg-accent-soft text-accent"
                          : "border-line bg-subtle text-mute hover:border-lineH hover:text-fg"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              {amount && !amountValid && (
                <p className="mt-1.5 text-xs text-bad">Escrow must be greater than 0 BOT.</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <DurationSelect
                label="Accept window"
                hint="Time the agent has to accept before you can reclaim."
                value={acceptWindow}
                onChange={setAcceptWindow}
                options={ACCEPT_OPTIONS}
              />
              <DurationSelect
                label="Work window"
                hint="Time the agent has after accepting to submit."
                value={workDuration}
                onChange={setWorkDuration}
                options={WORK_OPTIONS}
              />
              <DurationSelect
                label="Review window"
                hint="Your time to release or dispute after submission."
                value={reviewPeriod}
                onChange={setReviewPeriod}
                options={REVIEW_OPTIONS}
              />
            </div>
          </section>

          {/* Summary */}
          {(specText.trim() || agentValid) && (
            <div className="rounded-lg border border-line bg-well px-4 py-3 text-[13px]">
              <div className="micro mb-2">Summary</div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] text-faint">Agent</dt>
                  <dd className="font-mono text-mute">{agentValid ? shortAddress(agent.trim()) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Escrow</dt>
                  <dd className="font-mono text-mute tnum">
                    {amountValid ? `${formatEther(amountWei)} BOT` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-faint">Timeline</dt>
                  <dd className="text-mute">
                    {formatDurationLabel(Number(acceptWindow))} accept ·{" "}
                    {formatDurationLabel(Number(workDuration))} work ·{" "}
                    {formatDurationLabel(Number(reviewPeriod))} review
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {error && (
            <div className="banner-bad">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {created && (
            <div className="flex items-start gap-3 rounded-lg border border-ok-line bg-ok-soft px-4 py-3.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
                <Check size={14} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">
                  Task #{created.taskId} created — zero gas paid
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <button
                    onClick={() => router.push(`/task/${created.taskId}`)}
                    className="btn-success btn-sm"
                  >
                    View task <ArrowRight size={13} />
                  </button>
                  <a
                    href={explorerTx(created.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-mute transition hover:text-fg"
                  >
                    Transaction <ArrowUpRight size={12} />
                  </a>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !isConnected || underfunded || smartBalance === null}
            className="btn-primary w-full !py-3 text-[15px]"
          >
            {busy ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Creating task…
              </>
            ) : underfunded ? (
              <>Fund {formatEther(missing ?? 0n)} BOT to continue</>
            ) : (
              <>
                Create task
                <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  <Bolt size={11} /> 0 gas
                </span>
              </>
            )}
          </button>
          {underfunded && (
            <p className="text-center text-[11px] text-faint">
              Posting unlocks the moment your account holds the escrow — no wallet transaction from
              this app, ever.
            </p>
          )}
        </form>
      )}
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

/** Soft pre-flight on the pasted agent address before escrow is locked. */
function AgentCheck({ agent, onUse }: { agent: `0x${string}`; onUse: (sa: string) => void }) {
  const [info, setInfo] = useState<null | {
    smart: string;
    hasCode: boolean;
    owner: string | null;
    fromFactory: boolean;
  }>(null);
  const [rating, setRating] = useState<{ totalScore: bigint; count: bigint } | null>(null);
  const [ratingLoaded, setRatingLoaded] = useState(false);
  const [reputation, setReputation] = useState<{ completed: number; disputed: number } | null>(null);

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
          owner = null;
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
        /* no reputation shown */
      })
      .finally(() => alive && setRatingLoaded(true));
    return () => {
      alive = false;
    };
  }, [agent]);

  // Track record for the soft risk warning: how many of the agent's own
  // completed tasks ended in a dispute (same signal as the profile page via
  // fetchDisputedTaskIds). Purely advisory — creation is never blocked.
  useEffect(() => {
    let alive = true;
    setReputation(null);
    (async () => {
      try {
        const history = await fetchTaskHistory(agent);
        const agentTasks = history.filter(
          (t) => t.agent.toLowerCase() === agent.toLowerCase(),
        );
        const [completed, flagged] = await Promise.all([
          fetchAgentCompletedCount(agent),
          fetchDisputedTaskIds(agentTasks),
        ]);
        if (alive) setReputation({ completed, disputed: flagged.size });
      } catch {
        /* no reputation shown */
      }
    })();
    return () => {
      alive = false;
    };
  }, [agent]);

  if (!info) return null;

  let check: React.ReactNode = null;
  if (info.hasCode && info.owner === null) {
    check = (
      <div className="banner-bad mt-2 !py-2.5 !text-[13px]">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" />
        <span className="leading-relaxed">
          This address has code but is <strong className="font-medium">not a TaskPay account</strong>{" "}
          (no owner). It can never accept a task — creating anyway locks the escrow until you
          cancel or reclaim.
        </span>
      </div>
    );
  } else if (info.hasCode && info.owner) {
    check = (
      <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed">
        {info.fromFactory ? (
          <>
            <Check size={15} className="mt-0.5 shrink-0 text-ok" />
            <span className="text-mute">
              Verified TaskPay account — owned by{" "}
              <a
                href={explorerAddress(info.owner)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-ok underline-offset-2 hover:underline"
              >
                {shortAddress(info.owner)}
              </a>
            </span>
          </>
        ) : (
          <>
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
            <span className="text-mute">
              Contract with an owner (
              <a
                href={explorerAddress(info.owner)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-warn underline-offset-2 hover:underline"
              >
                {shortAddress(info.owner)}
              </a>
              ) but not TaskPay&apos;s standard account for that owner. Confirm it&apos;s the account you
              intend to hire.
            </span>
          </>
        )}
      </p>
    );
  } else {
    check = (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2.5 text-[13px] text-mute">
        <span className="min-w-0 leading-relaxed">
          This is a plain wallet — it acts on-chain as its account{" "}
          <span className="font-mono text-accent">{info.smart}</span>, deployed on first use.
        </span>
        <button
          type="button"
          onClick={() => onUse(info.smart)}
          className="btn-secondary btn-sm ml-auto shrink-0"
        >
          Use this account
        </button>
      </div>
    );
  }

  const ratingLine = ratingLoaded ? (
    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
      {rating && rating.count > 0n ? (
        <>
          <Star size={11} className="text-amber-500" />
          <span className="text-mute tnum">
            {(Number(rating.totalScore) / Number(rating.count)).toFixed(1)}
          </span>
          <span>
            · {rating.count.toString()} rating{rating.count === 1n ? "" : "s"} on-chain
          </span>
        </>
      ) : (
        <span>No on-chain ratings yet — the first completed task sets the record.</span>
      )}
    </p>
  ) : null;

  const ratingAvg = rating && rating.count > 0n ? Number(rating.totalScore) / Number(rating.count) : null;
  const lowRating = ratingAvg !== null && ratingAvg < 3.0;
  const disputeRisk =
    reputation !== null &&
    reputation.disputed > 0 &&
    (reputation.disputed >= 2 || reputation.completed <= 2);
  const riskWarn = lowRating || disputeRisk;

  return (
    <>
      {check}
      {ratingLine}
      {riskWarn && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-warn-line bg-warn-soft px-3.5 py-2.5">
          {lowRating && (
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-mute">
              <Star size={13} className="mt-0.5 shrink-0 text-warn" />
              <span>
                Rated{" "}
                <strong className="font-mono text-warn tnum">{ratingAvg!.toFixed(1)}</strong> across{" "}
                {rating!.count.toString()} review{rating!.count === 1n ? "" : "s"} — below the 3.0
                bar. This agent has a poor on-chain record.
              </span>
            </p>
          )}
          {disputeRisk && (
            <p className="flex items-start gap-2 text-[12px] leading-relaxed text-mute">
              <Scale size={13} className="mt-0.5 shrink-0 text-warn" />
              <span>
                {reputation!.disputed} dispute{reputation!.disputed === 1 ? "" : "s"} on record
                across {reputation!.completed} completed task
                {reputation!.completed === 1 ? "" : "s"}.{" "}
                <Link
                  href={`/agent/${agent}`}
                  className="text-warn underline underline-offset-2 hover:text-fg"
                >
                  Review the record
                </Link>{" "}
                before funding escrow.
              </span>
            </p>
          )}
        </div>
      )}
      {!riskWarn && reputation && reputation.completed > 0 && (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
          <Check size={11} className="text-ok" />
          <span className="text-mute">
            {reputation.completed} completed task{reputation.completed === 1 ? "" : "s"} · no
            disputes on record
          </span>
        </p>
      )}
    </>
  );
}
