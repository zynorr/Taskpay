"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import TaskActions from "@/components/TaskActions";
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
      <span className="mono-value">{label ?? value}</span>
      <button
        onClick={onCopy}
        title="Copy"
        className="rounded p-0.5 text-[10px] text-slate-600 transition hover:bg-slate-800 hover:text-slate-300"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">{label}</div>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

/** Horizontal lifecycle stepper. */
function LifecycleTimeline({ status }: { status: number }) {
  const steps = ["Created", "Accepted", "Submitted", "Ruling", "Settled"];
  let current = 0;
  let settledLabel: string | null = null;
  if (status === Status.Created) current = 0;
  else if (status === Status.Accepted) current = 1;
  else if (status === Status.Submitted) current = 2;
  else if (status >= Status.Disputed && status <= Status.Challenged) current = 3;
  else if (status === Status.Released) {
    current = 4;
    settledLabel = "Released · agent paid";
  } else if (status === Status.Refunded) {
    current = 4;
    settledLabel = "Refunded · requester back";
  } else {
    current = 0;
    settledLabel = "Cancelled";
  }

  const disputeStep =
    status === Status.Disputed ? "AI quorum ruling…" : status === Status.PendingChallenge ? "challenge window open" : status === Status.Challenged ? "Senior Arbiter ruling…" : null;

  return (
    <div className="card px-5 py-4">
      <ol className="flex items-center gap-1 sm:gap-2">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s} className="flex flex-1 items-center gap-1 sm:gap-2">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  done
                    ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
                    : active
                      ? "border-brand-500 bg-brand-600/20 text-brand-300 shadow-glow-sm"
                      : "border-slate-700 bg-slate-900 text-slate-600"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={`hidden text-[11px] font-medium sm:inline ${
                  active ? "text-white" : done ? "text-slate-300" : "text-slate-600"
                }`}
              >
                {s}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={`h-px flex-1 ${
                    i < current ? "bg-emerald-800/70" : "bg-slate-800"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
      {(disputeStep || settledLabel) && (
        <p className="mt-2.5 text-center text-[11px] font-medium text-slate-500">
          {disputeStep ?? settledLabel}
        </p>
      )}
    </div>
  );
}

function VerdictChip({ approved }: { approved: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
        approved
          ? "border-emerald-800/60 bg-emerald-950/50 text-emerald-300"
          : "border-rose-800/60 bg-rose-950/50 text-rose-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${approved ? "bg-emerald-400" : "bg-rose-400"}`} />
      {approved ? "APPROVE" : "REJECT"}
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

      // spec + reasoning from the oracle's archive (best-effort)
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
        <div className="flex items-center gap-3">
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-6 w-28 rounded-full" />
        </div>
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
        {error} · <Link href="/">back to tasks</Link>
      </div>
    );
  }
  if (!task) return null;

  const disputed = task.status >= Status.Disputed && task.status <= Status.Challenged;
  const activeDeadline =
    task.status === Status.Created
      ? { ts: task.acceptDeadline, label: "Accept window" }
      : task.status === Status.Accepted
        ? { ts: task.workDeadline, label: "Work deadline" }
        : task.status === Status.Submitted
          ? { ts: task.reviewDeadline, label: "Review window" }
          : null;

  const avgRating =
    rating && rating.count > 0n ? Number(rating.totalScore) / Number(rating.count) : null;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 transition hover:text-slate-300"
        >
          ← Back to marketplace
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Task <span className="font-mono">#{task.taskId.toString()}</span>
          </h1>
          <StatusBadge
            status={task.status}
            pulse={disputed}
          />
        </div>
      </div>

      <LifecycleTimeline status={task.status} />

      {/* Key facts */}
      <div className="card p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Requester">
            <CopyValue value={task.requester} label={shortAddress(task.requester)} />
            <a
              href={explorerAddress(task.requester)}
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-[10px] text-slate-600 hover:text-brand-300"
            >
              ↗
            </a>
          </Field>
          <Field label="Agent">
            <CopyValue value={task.agent} label={shortAddress(task.agent)} />
            <a
              href={explorerAddress(task.agent)}
              target="_blank"
              rel="noreferrer"
              className="ml-1 text-[10px] text-slate-600 hover:text-brand-300"
            >
              ↗
            </a>
          </Field>
          <Field label="Escrow">
            <span className="text-base font-bold text-slate-100">
              {formatAmount(task.amount)} <span className="text-xs font-medium text-slate-500">BOT</span>
            </span>
          </Field>
          <Field label="Agent rating">
            {avgRating === null ? (
              <span className="text-slate-600">not rated yet</span>
            ) : (
              <span className="text-amber-400">
                {"★".repeat(Math.round(avgRating))}
                <span className="ml-1.5 font-mono text-xs text-slate-500">
                  {avgRating.toFixed(1)} / 5 · {rating!.count.toString()} rating
                  {rating!.count === 1n ? "" : "s"}
                </span>
              </span>
            )}
          </Field>
          <Field label="Created">
            <span className="text-slate-300">{formatTimestamp(task.createdAt)}</span>
          </Field>
          <Field label="specHash">
            <CopyValue value={fullHash(task.specHash)} label={shortHash(task.specHash) || "—"} />
          </Field>
          <Field label="Accept window">
            <span className="text-slate-300">{formatTimestamp(task.acceptDeadline)}</span>
          </Field>
          <Field label="Work deadline">
            <span className="text-slate-300">{formatTimestamp(task.workDeadline)}</span>
          </Field>
          <Field label="Review window">
            <span className="text-slate-300">{formatTimestamp(task.reviewDeadline)}</span>
          </Field>
        </div>

        {activeDeadline && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-2.5 text-sm">
            <span className="h-2 w-2 rounded-full bg-brand-400 animate-pulse-dot" />
            <span className="text-slate-400">{activeDeadline.label} closes in</span>
            <span
              className={`font-mono font-bold ${
                deadlineUrgency(activeDeadline.ts) === "expired"
                  ? "text-rose-400"
                  : deadlineUrgency(activeDeadline.ts) === "critical"
                    ? "text-orange-300"
                    : "text-slate-100"
              }`}
            >
              {timeLeft(activeDeadline.ts)}
            </span>
            <span className="text-xs text-slate-600">· {formatFullTimestamp(activeDeadline.ts)}</span>
          </div>
        )}
      </div>

      {/* Spec */}
      {spec?.spec_text && (
        <div className="card p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200">
            <span className="text-base">📋</span> Spec
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
            {spec.spec_text}
          </p>
        </div>
      )}

      {/* Deliverable */}
      <div className="card p-5">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200">
          <span className="text-base">📦</span> Deliverable
        </h2>
        {task.submission ? (
          <div className="space-y-1.5">
            <p className="break-all text-sm leading-relaxed text-slate-400">{task.submission}</p>
            {/^https?:\/\//.test(task.submission.trim()) && (
              <a
                href={task.submission.trim()}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-300 underline-offset-2 hover:underline"
              >
                open link ↗
              </a>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-600">Not submitted yet.</p>
        )}
      </div>

      {/* Dispute panel */}
      {disputed && (
        <div className="card border-amber-800/40 p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-amber-300">
            <span className="text-base">⚖️</span> Dispute
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
                    ? "APPROVE agent"
                    : "REFUND requester"
                  : "…"}
              </span>
            </Field>
            <Field label="Challenge window">
              {dispute ? (
                <span
                  className={
                    dispute.challengeDeadline > BigInt(Math.floor(Date.now() / 1000))
                      ? "text-amber-300"
                      : "text-slate-500"
                  }
                >
                  {timeLeft(dispute.challengeDeadline)}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field label="Challenged">
              <span>{dispute?.hasChallenged ? "yes" : "no"}</span>
            </Field>
            <Field label="Senior Arbiter window">
              {dispute && dispute.seniorArbiterDeadline > 0n ? (
                <span className="text-violet-300">{timeLeft(dispute.seniorArbiterDeadline)}</span>
              ) : (
                "—"
              )}
            </Field>
          </div>

          {/* On-chain AI verdicts */}
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            AI verdicts (on-chain)
          </h3>
          <div className="grid gap-2 sm:grid-cols-3">
            {verdicts.map((v, i) => (
              <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-300">
                    {ROLE_DISPLAY[i] ?? `Agent ${i}`}
                  </span>
                  {v.hasVoted ? (
                    <VerdictChip approved={v.approved} />
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-600 animate-pulse-dot" />
                      ruling…
                    </span>
                  )}
                </div>
                {v.hasVoted && (
                  <div className="mt-2">
                    <CopyValue value={fullHash(v.reasoningHash)} label={`hash ${shortHash(v.reasoningHash)}`} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Archived reasoning */}
          {reasoning.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                AI reasoning (oracle archive)
              </h3>
              <div className="space-y-2">
                {reasoning.map((r, i) => (
                  <details
                    key={i}
                    className="group rounded-xl border border-slate-800 bg-slate-950/60 p-3 open:bg-slate-950/80"
                  >
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${r.verdict ? "bg-emerald-400" : "bg-rose-400"}`}
                      />
                      {r.agent_role.replace("_", " ")}
                      <VerdictChip approved={r.verdict} />
                      <span className="ml-auto text-slate-600 transition group-open:rotate-90">▸</span>
                    </summary>
                    <p className="mt-2.5 whitespace-pre-wrap rounded-lg border border-slate-800/60 bg-slate-900/40 p-3 text-sm leading-relaxed text-slate-400">
                      {r.reasoning_text}
                    </p>
                    <p className="mt-2 font-mono text-[10px] text-slate-600">
                      {r.created_at} · {r.reasoning_hash}
                    </p>
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-200">
          <span className="text-base">⚡</span> Actions
        </h2>
        <TaskActions task={task} dispute={dispute} onSettled={load} />
      </div>
    </div>
  );
}