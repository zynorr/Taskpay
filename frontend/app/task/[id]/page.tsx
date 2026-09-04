"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import TaskActions from "@/components/TaskActions";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Package,
  Scale,
  ShieldCheck,
  Star,
} from "@/components/icons";
import { fetchTask, fetchVerdicts, fetchDispute, fetchAgentRating } from "@/lib/tasks";
import { Status } from "@/lib/contract";
import {
  shortAddress,
  shortHash,
  fullHash,
  formatAmount,
  formatTimestamp,
  formatFullTimestamp,
  timeLeft,
  deadlineUrgency,
  explorerAddress,
  copyText,
} from "@/lib/format";
import type { TaskView, VerdictView, DisputeView, ReasoningRow, SpecRow } from "@/lib/types";

const ROLE_DISPLAY = ["Reviewer", "Fraud / Sanity", "Senior Arbiter"];

function CopyValue({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }, [value]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="copyable">{label ?? value}</span>
      <button
        onClick={onCopy}
        title="Copy"
        className="rounded p-1 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-300"
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      </button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="micro">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function PartyLink({ address }: { address: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <CopyValue value={address} label={shortAddress(address)} />
      <a
        href={explorerAddress(address)}
        target="_blank"
        rel="noreferrer"
        title="View on explorer"
        className="rounded p-1 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-300"
      >
        <ArrowUpRight size={12} />
      </a>
    </span>
  );
}

function LifecycleTimeline({ status }: { status: number }) {
  const steps = ["Posted", "Accepted", "Submitted", "Ruling", "Settled"];
  let current = 0;
  let detail: string | null = null;
  if (status === Status.Created) current = 0;
  else if (status === Status.Accepted) current = 1;
  else if (status === Status.Submitted) current = 2;
  else if (status >= Status.Disputed && status <= Status.Challenged) current = 3;
  else if (status === Status.Released || status === Status.Refunded) {
    current = 4;
    detail =
      status === Status.Released
        ? "Escrow released to the agent"
        : "Escrow refunded to the requester";
  } else {
    current = 0;
    detail = "Cancelled before acceptance";
  }

  const phase =
    status === Status.Disputed
      ? "AI quorum ruling"
      : status === Status.PendingChallenge
        ? "Challenge window open"
        : status === Status.Challenged
          ? "Senior Arbiter appeal"
          : null;

  return (
    <div className="panel px-5 py-4">
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className="flex flex-1 items-center last:flex-none">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : active
                      ? "border-iris-500/60 bg-iris-500/15 text-iris-200"
                      : "border-white/10 bg-white/[0.02] text-zinc-600"
                }`}
              >
                {done ? <Check size={12} /> : <span className="text-[10px] font-semibold">{i + 1}</span>}
              </span>
              <span
                className={`ml-2 text-xs font-medium ${
                  active ? "text-white" : done ? "text-zinc-300" : "text-zinc-600"
                } ${active && phase ? "" : ""}`}
              >
                {s}
              </span>
              {i < steps.length - 1 && (
                <span className={`mx-2 h-px flex-1 sm:mx-3 ${i < current ? "bg-emerald-500/30" : "bg-white/[0.08]"}`} />
              )}
            </li>
          );
        })}
      </ol>
      {(phase || detail) && (
        <p className="mt-3 text-center text-[11px] font-medium text-zinc-500">
          {phase ?? detail}
        </p>
      )}
    </div>
  );
}

function VerdictChip({ approved }: { approved: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
        approved
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-emerald-400" : "bg-rose-400"}`} />
      {approved ? "Approve" : "Reject"}
    </span>
  );
}

function VerdictGrid({ verdicts }: { verdicts: VerdictView[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {verdicts.map((v, i) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-ink-900/50 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-zinc-300">
              {ROLE_DISPLAY[i] ?? `Agent ${i}`}
            </span>
            {v.hasVoted ? (
              <VerdictChip approved={v.approved} />
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-zinc-600">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-pulse-soft" />
                ruling
              </span>
            )}
          </div>
          {v.hasVoted && (
            <div className="mt-2.5">
              <CopyValue
                value={fullHash(v.reasoningHash)}
                label={shortHash(v.reasoningHash) || "reasoning hash"}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ReasoningArchive({ reasoning }: { reasoning: ReasoningRow[] }) {
  if (reasoning.length === 0) return null;
  return (
    <div className="mt-5">
      <h3 className="micro mb-2.5">Archived reasoning</h3>
      <div className="space-y-2">
        {reasoning.map((r, i) => (
          <details key={i} className="group rounded-lg border border-white/[0.06] bg-ink-900/40 open:bg-ink-900/70">
            <summary className="flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-zinc-300 transition hover:text-white">
              <span
                className={`h-1.5 w-1.5 rounded-full ${r.verdict ? "bg-emerald-400" : "bg-rose-400"}`}
              />
              <span className="capitalize">{r.agent_role.replaceAll("_", " ")}</span>
              <VerdictChip approved={r.verdict} />
              <ChevronDown
                size={14}
                className="ml-auto text-zinc-600 transition group-open:rotate-180"
              />
            </summary>
            <div className="px-3.5 pb-3.5">
              <p className="whitespace-pre-wrap rounded-lg border border-white/[0.05] bg-ink-950/60 p-3 text-[13px] leading-relaxed text-zinc-400">
                {r.reasoning_text}
              </p>
              <p className="mt-2 font-mono text-[10px] text-zinc-600">
                {r.created_at} · {r.reasoning_hash}
              </p>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function Rating({ avg, count }: { avg: number | null; count: bigint }) {
  if (avg === null) {
    return <span className="text-xs text-zinc-600">Not rated yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={13}
            className={n <= Math.round(avg) ? "text-amber-400" : "text-zinc-700"}
          />
        ))}
      </span>
      <span className="font-mono text-xs text-zinc-400 tnum">
        {avg.toFixed(1)} · {count.toString()} rating{count === 1n ? "" : "s"}
      </span>
    </span>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [taskId, setTaskId] = useState<bigint | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictView[]>([]);
  const [dispute, setDispute] = useState<DisputeView | null>(null);
  const [spec, setSpec] = useState<SpecRow | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningRow[]>([]);
  const [rating, setRating] = useState<{ totalScore: bigint; count: bigint } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => setTaskId(BigInt(id))).catch(() => setError("Invalid task id"));
  }, [params]);

  const load = useCallback(async () => {
    if (taskId === null) return;
    setLoading(true);
    setError(null);
    try {
      const [t, v, d] = await Promise.all([
        fetchTask(taskId),
        fetchVerdicts(taskId),
        fetchDispute(taskId),
      ]);
      setTask(t);
      setVerdicts(v);
      setDispute(d);
      fetchAgentRating(t.agent).then((r) => setRating(r));

      try {
        const specRes = await fetch(`/api/specs/${taskId}`);
        if (specRes.ok) setSpec(await specRes.json());
      } catch {
        /* archive may not have the spec registered */
      }
      try {
        const res = await fetch(`/api/reasoning/${taskId}`);
        if (res.ok) {
          const body = await res.json();
          setReasoning(body.rows ?? []);
        }
      } catch {
        /* archive may be empty */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-56" />
        <div className="skeleton h-16 w-full" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-6 py-14 text-center">
        <p className="text-sm text-zinc-300">{error}</p>
        <Link href="/" className="btn-secondary btn-sm">
          Back to marketplace
        </Link>
      </div>
    );
  }
  if (!task) return null;

  const disputed = task.status >= Status.Disputed && task.status <= Status.Challenged;
  const wasDisputed =
    !disputed && (reasoning.length > 0 || verdicts.some((v) => v.hasVoted));
  const activeDeadline =
    task.status === Status.Created
      ? { ts: task.acceptDeadline, label: "Accept window" }
      : task.status === Status.Accepted
        ? { ts: task.workDeadline, label: "Work window" }
        : task.status === Status.Submitted
          ? { ts: task.reviewDeadline, label: "Review window" }
          : null;

  const avgRating =
    rating && rating.count > 0n ? Number(rating.totalScore) / Number(rating.count) : null;
  const deadlineMeta = activeDeadline
    ? {
        urgency: deadlineUrgency(activeDeadline.ts),
        label: activeDeadline.label,
        ts: activeDeadline.ts,
      }
    : null;

  return (
    <div className="animate-fade-up mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-zinc-500 transition hover:text-zinc-200"
        >
          <ArrowLeft size={14} /> Marketplace
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-mono text-xl font-semibold tracking-tight text-white tnum">
            Task #{task.taskId.toString().padStart(3, "0")}
          </h1>
          <StatusBadge status={task.status} pulse={disputed} />
        </div>
      </div>

      <LifecycleTimeline status={task.status} />

      {/* Overview */}
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="micro">Escrow</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight text-white tnum">
              {formatAmount(task.amount)}
              <span className="ml-1.5 text-base font-normal text-zinc-500">BOT</span>
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              Created {formatTimestamp(task.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <PartyLink address={task.requester} />
            <ArrowRight size={13} className="text-zinc-700" />
            <PartyLink address={task.agent} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/[0.06] pt-5 sm:grid-cols-4">
          <Field label="Requester">
            <PartyLink address={task.requester} />
          </Field>
          <Field label="Agent">
            <PartyLink address={task.agent} />
          </Field>
          <Field label="Agent rating">
            <Rating avg={avgRating} count={rating?.count ?? 0n} />
          </Field>
          <Field label="Spec hash">
            <CopyValue value={fullHash(task.specHash)} label={shortHash(task.specHash) || "—"} />
          </Field>
        </div>

        {/* Deadlines */}
        <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06]">
          {[
            { label: "Accept by", ts: task.acceptDeadline },
            { label: "Work by", ts: task.workDeadline },
            { label: "Review by", ts: task.reviewDeadline },
          ].map((d) => (
            <div key={d.label} className="bg-ink-950 px-4 py-3">
              <div className="micro">{d.label}</div>
              <div className="mt-0.5 font-mono text-xs text-zinc-400 tnum">
                {d.ts === 0n ? "—" : formatTimestamp(d.ts)}
              </div>
            </div>
          ))}
        </div>

        {deadlineMeta && (
          <div
            className={`mt-3 flex items-center gap-2.5 rounded-lg border px-4 py-3 ${
              deadlineMeta.urgency === "expired"
                ? "border-rose-500/25 bg-rose-500/[0.06]"
                : deadlineMeta.urgency === "critical"
                  ? "border-orange-500/25 bg-orange-500/[0.06]"
                  : "border-white/[0.06] bg-ink-900/60"
            }`}
          >
            <Clock
              size={15}
              className={
                deadlineMeta.urgency === "expired"
                  ? "text-rose-400"
                  : deadlineMeta.urgency === "critical"
                    ? "text-orange-400"
                    : "text-zinc-500"
              }
            />
            <span className="text-[13px] text-zinc-400">
              {deadlineMeta.label}{" "}
              {deadlineMeta.urgency === "expired" ? "elapsed" : "closes in"}
            </span>
            <span
              className={`ml-auto font-mono text-sm font-semibold tnum ${
                deadlineMeta.urgency === "expired"
                  ? "text-rose-300"
                  : deadlineMeta.urgency === "critical"
                    ? "text-orange-300"
                    : "text-zinc-100"
              }`}
            >
              {timeLeft(deadlineMeta.ts)}
            </span>
          </div>
        )}
      </section>

      {/* Spec + deliverable */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <FileText size={15} className="text-iris-400" /> Spec
          </h2>
          {spec?.spec_text ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-400">
              {spec.spec_text}
            </p>
          ) : (
            <p className="text-[13px] text-zinc-600">
              Spec text not in the archive — the on-chain hash is the anchor.
            </p>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Package size={15} className="text-iris-400" /> Deliverable
          </h2>
          {task.submission ? (
            <div className="space-y-2">
              <p className="break-all text-[13px] leading-relaxed text-zinc-400">
                {task.submission}
              </p>
              {/^https?:\/\//.test(task.submission.trim()) && (
                <a
                  href={task.submission.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-iris-300 underline-offset-2 hover:underline"
                >
                  Open link <ArrowUpRight size={12} />
                </a>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-zinc-600">No deliverable submitted yet.</p>
          )}
        </section>
      </div>

      {/* Live dispute */}
      {disputed && (
        <section className="panel border-amber-500/20 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-amber-200">
            <Scale size={15} className="text-amber-400" /> Dispute
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="Tentative outcome">
              <span
                className={`font-semibold ${
                  dispute?.tentativeApproved ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {dispute
                  ? dispute.tentativeApproved
                    ? "Pay the agent"
                    : "Refund the requester"
                  : "Pending quorum"}
              </span>
            </Field>
            <Field label="Challenge window">
              {dispute ? (
                <span
                  className={`font-mono text-xs tnum ${
                    dispute.challengeDeadline > BigInt(Math.floor(Date.now() / 1000))
                      ? "text-amber-300"
                      : "text-zinc-500"
                  }`}
                >
                  {timeLeft(dispute.challengeDeadline)}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Challenged">
              <span className="text-xs">
                {dispute?.hasChallenged ? "Yes — Senior Arbiter" : "No"}
              </span>
            </Field>
            <Field label="Arbiter deadline">
              {dispute && dispute.seniorArbiterDeadline > 0n ? (
                <span className="font-mono text-xs text-violet-300 tnum">
                  {timeLeft(dispute.seniorArbiterDeadline)}
                </span>
              ) : (
                "—"
              )}
            </Field>
          </div>
          <h3 className="micro mb-2.5 mt-5">On-chain verdicts</h3>
          <VerdictGrid verdicts={verdicts} />
          <ReasoningArchive reasoning={reasoning} />
        </section>
      )}

      {/* Settled but disputed — the ruling trail stays visible */}
      {wasDisputed && (
        <section className="panel p-5">
          <div
            className={`mb-5 flex items-start gap-3 rounded-lg border px-4 py-3.5 ${
              task.status === Status.Refunded
                ? "border-rose-500/25 bg-rose-500/[0.06]"
                : task.status === Status.Cancelled
                  ? "border-white/10 bg-white/[0.02]"
                  : "border-emerald-500/25 bg-emerald-500/[0.06]"
            }`}
          >
            <span
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                task.status === Status.Refunded
                  ? "bg-rose-500/15 text-rose-300"
                  : task.status === Status.Cancelled
                    ? "bg-white/[0.06] text-zinc-400"
                    : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {task.status === Status.Refunded ? (
                <Scale size={16} />
              ) : task.status === Status.Cancelled ? (
                <ShieldCheck size={16} />
              ) : (
                <Check size={16} />
              )}
            </span>
            <div>
              <div className="text-sm font-semibold text-zinc-100">
                {task.status === Status.Refunded
                  ? "Escrow refunded to the requester"
                  : task.status === Status.Cancelled
                    ? "Task cancelled"
                    : "Escrow released to the agent"}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                Settled after the AI trail below
                {dispute?.hasChallenged ? ", including a Senior Arbiter appeal" : ""}.
              </p>
            </div>
          </div>
          <h3 className="micro mb-2.5">On-chain verdicts</h3>
          <VerdictGrid verdicts={verdicts} />
          <ReasoningArchive reasoning={reasoning} />
        </section>
      )}

      {/* Actions (incl. rating after a release) */}
      {task.status !== Status.Refunded && task.status !== Status.Cancelled && (
        <section className="panel p-5">
          <h2 className="micro mb-3">Actions</h2>
          <TaskActions task={task} dispute={dispute} onSettled={load} />
        </section>
      )}
    </div>
  );
}
