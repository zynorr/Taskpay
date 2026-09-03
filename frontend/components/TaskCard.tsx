"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import {
  shortAddress,
  formatAmount,
  timeLeft,
  deadlineUrgency,
  explorerAddress,
} from "@/lib/format";
import { Status } from "@/lib/contract";
import type { TaskView, DisputeView } from "@/lib/types";

const URGENCY_TEXT: Record<string, string> = {
  ok: "text-slate-400",
  soon: "text-amber-300",
  critical: "text-orange-300",
  expired: "text-rose-400",
};

export default function TaskCard({
  task,
  dispute,
  isMine,
  myAddrs,
}: {
  task: TaskView;
  dispute?: DisputeView | null;
  isMine?: boolean;
  myAddrs?: string[];
}) {
  const role =
    myAddrs && myAddrs.includes(task.requester.toLowerCase())
      ? "requester"
      : myAddrs && myAddrs.includes(task.agent.toLowerCase())
        ? "agent"
        : null;

  // Which deadline governs the current state?
  const deadline =
    task.status === Status.Created
      ? task.acceptDeadline
      : task.status === Status.Accepted
        ? task.workDeadline
        : task.status === Status.Submitted
          ? task.reviewDeadline
          : null;

  const urgency = deadline ? deadlineUrgency(deadline) : null;

  return (
    <Link
      href={`/task/${task.taskId}`}
      className="card group block p-4 transition hover:border-brand-700/70 hover:shadow-glow sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-sm font-semibold text-slate-300">
            #{task.taskId.toString()}
          </span>
          {isMine && role && (
            <span
              className={`chip ${
                role === "requester"
                  ? "border-brand-700/60 bg-brand-950/40 text-brand-300"
                  : "border-cyan-800/60 bg-cyan-950/40 text-cyan-300"
              }`}
            >
              your {role}
            </span>
          )}
        </div>
        <StatusBadge status={task.status} pulse={task.status >= Status.Disputed && task.status <= Status.Challenged} />
      </div>

      <div className="grid grid-cols-2 items-center gap-x-4 gap-y-3 sm:grid-cols-[1.1fr_1.1fr_auto_auto]">
        {/* Parties */}
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            Requester
          </div>
          <a
            href={explorerAddress(task.requester)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs text-slate-300 transition hover:text-brand-300"
            title="View on explorer"
          >
            {shortAddress(task.requester)}
          </a>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            Agent
          </div>
          <a
            href={explorerAddress(task.agent)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs text-slate-300 transition hover:text-brand-300"
            title="View on explorer"
          >
            {shortAddress(task.agent)}
          </a>
        </div>

        {/* Escrow */}
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            Escrow
          </div>
          <div className="text-sm font-bold text-slate-100">
            {formatAmount(task.amount)}{" "}
            <span className="text-xs font-medium text-slate-500">BOT</span>
          </div>
        </div>

        {/* Deadline / dispute state */}
        <div className="text-right">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
            {task.status === Status.Created
              ? "Accept by"
              : task.status === Status.Accepted
                ? "Work due"
                : task.status === Status.Submitted
                  ? "Review by"
                  : task.status >= Status.Disputed && task.status <= Status.Challenged
                    ? "Dispute"
                    : "State"}
          </div>
          {deadline && urgency ? (
            <div className={`font-mono text-xs font-semibold ${URGENCY_TEXT[urgency]}`}>
              {timeLeft(deadline)}
            </div>
          ) : task.status === Status.Disputed || task.status === Status.PendingChallenge ? (
            <div className="font-mono text-xs font-semibold text-amber-300">
              {dispute?.hasChallenged
                ? "at Senior Arbiter"
                : "awaiting AI ruling"}
            </div>
          ) : task.status === Status.Challenged ? (
            <div className="font-mono text-xs font-semibold text-violet-300">arbiter ruling…</div>
          ) : task.status === Status.Released ? (
            <div className="font-mono text-xs font-semibold text-emerald-300">paid ✓</div>
          ) : task.status === Status.Refunded ? (
            <div className="font-mono text-xs font-semibold text-rose-300">refunded</div>
          ) : (
            <div className="font-mono text-xs text-slate-600">—</div>
          )}
        </div>
      </div>

      {/* Dispute hint bar */}
      {task.status >= Status.Disputed && task.status <= Status.Challenged && dispute && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3 text-[11px] text-slate-500">
          <span
            className={`rounded-md px-1.5 py-0.5 font-semibold ${
              dispute.tentativeApproved
                ? "bg-emerald-950/60 text-emerald-300"
                : "bg-rose-950/60 text-rose-300"
            }`}
          >
            tentative: {dispute.tentativeApproved ? "APPROVE agent" : "REFUND requester"}
          </span>
          {!dispute.hasChallenged && task.status === Status.PendingChallenge && (
            <span>
              challenge window{" "}
              <span className="font-mono text-amber-300">
                {timeLeft(dispute.challengeDeadline)}
              </span>
            </span>
          )}
        </div>
      )}
    </Link>
  );
}