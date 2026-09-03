"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import TaskActions from "@/components/TaskActions";
import { fetchTask, fetchVerdicts, fetchDispute } from "@/lib/tasks";
import { ROLE_LABELS } from "@/lib/contract";
import { shortAddress, shortHash, formatAmount, formatTimestamp, timeLeft } from "@/lib/format";
import type { TaskView, VerdictView, DisputeView, ReasoningRow, SpecRow } from "@/lib/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono text-sm">{children}</div>
    </div>
  );
}

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [taskId, setTaskId] = useState<bigint | null>(null);
  const [task, setTask] = useState<TaskView | null>(null);
  const [verdicts, setVerdicts] = useState<VerdictView[]>([]);
  const [dispute, setDispute] = useState<DisputeView | null>(null);
  const [spec, setSpec] = useState<SpecRow | null>(null);
  const [reasoning, setReasoning] = useState<ReasoningRow[]>([]);
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

  if (loading) return <p className="text-sm text-slate-500">Loading task…</p>;
  if (error) {
    return (
      <div className="rounded-lg border border-rose-900 bg-rose-950/50 p-4 text-sm text-rose-300">
        {error} · <Link href="/">back to tasks</Link>
      </div>
    );
  }
  if (!task) return null;

  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Task #{task.taskId.toString()}</h1>
        <StatusBadge status={task.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 sm:grid-cols-4">
        <Field label="Requester">{shortAddress(task.requester)}</Field>
        <Field label="Agent">{shortAddress(task.agent)}</Field>
        <Field label="Escrow">{formatAmount(task.amount)} BOT</Field>
        <Field label="specHash">{shortHash(task.specHash) ?? "—"}</Field>
        <Field label="Created">{formatTimestamp(task.createdAt)}</Field>
        <Field label="Accept deadline">
          {formatTimestamp(task.acceptDeadline)} ({timeLeft(task.acceptDeadline)})
        </Field>
        <Field label="Work deadline">
          {formatTimestamp(task.workDeadline)} ({timeLeft(task.workDeadline)})
        </Field>
        <Field label="Review deadline">
          {formatTimestamp(task.reviewDeadline)} ({timeLeft(task.reviewDeadline)})
        </Field>
      </div>

      {spec?.spec_text && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Spec</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-400">{spec.spec_text}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Deliverable</h2>
        {task.submission ? (
          <p className="break-all text-sm text-slate-400">{task.submission}</p>
        ) : (
          <p className="text-sm text-slate-600">Not submitted yet.</p>
        )}
      </div>

      {/* Dispute panel */}
      {(task.status >= 3 && task.status <= 5) && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/20 p-5">
          <h2 className="mb-3 text-sm font-semibold text-amber-300">Dispute</h2>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Tentative outcome">
              {dispute ? (dispute.tentativeApproved ? "APPROVE agent" : "REFUND requester") : "—"}
            </Field>
            <Field label="Challenge deadline">
              {dispute ? `${formatTimestamp(dispute.challengeDeadline)} (${timeLeft(dispute.challengeDeadline)})` : "—"}
            </Field>
            <Field label="Challenged">{dispute?.hasChallenged ? "yes" : "no"}</Field>
            <Field label="Senior arbiter deadline">
              {dispute && dispute.seniorArbiterDeadline > 0n
                ? `${formatTimestamp(dispute.seniorArbiterDeadline)} (${timeLeft(dispute.seniorArbiterDeadline)})`
                : "—"}
            </Field>
          </div>

          {/* AI quorum verdicts */}
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            AI quorum verdicts
          </h3>
          <div className="space-y-2">
            {verdicts.map((v, i) => (
              <div key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">{ROLE_LABELS[i]}</span>
                  {v.hasVoted ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        v.approved ? "bg-emerald-900 text-emerald-200" : "bg-rose-900 text-rose-200"
                      }`}
                    >
                      {v.approved ? "APPROVE" : "REJECT"}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">no vote</span>
                  )}
                </div>
                {v.hasVoted && (
                  <p className="mt-1 font-mono text-[11px] text-slate-600">
                    reasoning hash: {shortHash(v.reasoningHash) ?? "—"}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Archived reasoning */}
          {reasoning.length > 0 && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                AI reasoning (oracle archive)
              </h3>
              <div className="space-y-2">
                {reasoning.map((r, i) => (
                  <details key={i} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-slate-300">
                      {r.agent_role.replace("_", " ")}{" "}
                      <span className={r.verdict ? "text-emerald-400" : "text-rose-400"}>
                        {r.verdict ? "APPROVE" : "REJECT"}
                      </span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{r.reasoning_text}</p>
                    <p className="mt-2 font-mono text-[11px] text-slate-600">{r.reasoning_hash}</p>
                  </details>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Actions</h2>
        <TaskActions task={task} dispute={dispute} onSettled={load} />
      </div>

      <p className="text-xs text-slate-600">
        Deadline state: now = {new Date(Number(now) * 1000).toISOString()}. Unchallenged outcomes
        finalize automatically after their windows; see the contract for exact rules.
      </p>
    </div>
  );
}