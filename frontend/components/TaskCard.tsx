"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { ArrowRight, Clock } from "./icons";
import {
  shortAddress,
  formatAmount,
  timeLeft,
  deadlineUrgency,
  explorerAddress,
  taskTitle,
  taskSummary,
} from "@/lib/format";
import { Status } from "@/lib/contract";
import type { TaskView, DisputeView, SpecSummary } from "@/lib/types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const URGENCY: Record<string, string> = {
  ok: "text-mute",
  soon: "text-warn",
  critical: "text-warn2",
  expired: "text-bad",
};

export default function TaskCard({
  task,
  dispute,
  spec,
  isMine,
  myAddrs,
}: {
  task: TaskView;
  dispute?: DisputeView | null;
  spec?: SpecSummary;
  isMine?: boolean;
  myAddrs?: string[];
}) {
  const isOpen = task.agent === ZERO_ADDRESS;
  const role =
    myAddrs && myAddrs.includes(task.requester.toLowerCase())
      ? "requester"
      : myAddrs && !isOpen && myAddrs.includes(task.agent.toLowerCase())
        ? "agent"
        : null;

  const deadline =
    task.status === Status.Created
      ? task.acceptDeadline
      : task.status === Status.Accepted
        ? task.workDeadline
        : task.status === Status.Submitted
          ? task.reviewDeadline
          : null;

  const urgency = deadline ? deadlineUrgency(deadline) : null;
  const disputePhase = task.status >= Status.Disputed && task.status <= Status.Challenged;

  const deadlineMeta =
    deadline && urgency ? (
      <span className={`flex items-center gap-1.5 ${URGENCY[urgency]}`}>
        <Clock size={13} className="opacity-70" />
        <span className="font-mono text-xs font-semibold tnum">{timeLeft(deadline)}</span>
      </span>
    ) : null;

  const stateLine = disputePhase ? (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      {dispute ? (
        <>
          <span
            className={`font-medium ${
              dispute.tentativeApproved ? "text-ok" : "text-bad"
            }`}
          >
            {dispute.tentativeApproved ? "Tentative: pay agent" : "Tentative: refund"}
          </span>
          {!dispute.hasChallenged && task.status === Status.PendingChallenge && (
            <span className="text-mute">
              challenge window{" "}
              <span className="font-mono text-warn tnum">{timeLeft(dispute.challengeDeadline)}</span>
            </span>
          )}
          {dispute.hasChallenged && <span className="text-fu">Senior Arbiter reviewing</span>}
        </>
      ) : (
        <span className="text-warn">AI quorum ruling</span>
      )}
    </span>
  ) : task.status === Status.Released ? (
    <span className="text-xs font-medium text-ok">Escrow paid to agent</span>
  ) : task.status === Status.Refunded ? (
    <span className="text-xs font-medium text-bad">Escrow refunded</span>
  ) : task.status === Status.Cancelled ? (
    <span className="text-xs font-medium text-faint">Cancelled by requester</span>
  ) : null;

  const title = taskTitle(spec?.name, spec?.spec_text);
  const summary = spec?.spec_text ? taskSummary(spec.spec_text) : null;

  const deadlineLabel =
    task.status === Status.Created
      ? "Accept window"
      : task.status === Status.Accepted
        ? "Work deadline"
        : task.status === Status.Submitted
          ? "Review window"
          : null;

  return (
    <Link href={`/task/${task.taskId}`} className="card-link group p-4 sm:p-5">
      {/* Top row: name + escrow */}
      <div className="flex items-start justify-between gap-x-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-faint tnum">
              #{task.taskId.toString().padStart(3, "0")}
            </span>
            <StatusBadge status={task.status} pulse={disputePhase} />
            {isOpen && task.status === Status.Created && (task.minRating ?? 0) > 0 && (
              <span
                className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent tnum"
                title={`Only agents with a ${task.minRating}+ on-chain rating can claim`}
              >
                {task.minRating}+ rating
              </span>
            )}
            {isMine && role && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  role === "requester"
                    ? "border-accent-line bg-accent-soft text-accent"
                    : "border-info-line bg-info-soft text-info"
                }`}
              >
                Your task
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-[15px] font-semibold tracking-tight text-fg group-hover:text-accent">
            {title}
          </h3>
          {summary && (
            <p className="mt-1 line-clamp-2 max-w-2xl text-[13px] leading-relaxed text-mute">
              {summary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-x-8">
          <div className="text-right">
            <div className="micro">Escrow</div>
            <div className="mt-0.5 text-[15px] font-semibold text-fg tnum">
              {formatAmount(task.amount)}
              <span className="ml-1 text-xs font-normal text-mute">BOT</span>
            </div>
          </div>
          {deadlineMeta && deadlineLabel && (
            <div className="hidden text-right sm:block">
              <div className="micro">{deadlineLabel}</div>
              <div className="mt-0.5">{deadlineMeta}</div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: parties + state */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-lineSoft pt-3 text-xs">
        <a
          href={explorerAddress(task.requester)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="font-mono text-mute transition hover:text-accent"
          title="Requester"
        >
          {shortAddress(task.requester)}
        </a>
        <ArrowRight size={12} className="text-faint" />
        {isOpen ? (
          <span
            className="rounded border border-accent-line bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
            title="Any agent can claim — first to accept wins"
          >
            Open
          </span>
        ) : (
          <Link
            href={`/agent/${task.agent}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-mute transition hover:text-accent"
            title="Agent profile"
          >
            {shortAddress(task.agent)}
          </Link>
        )}
        {stateLine && (
          <>
            <span className="hidden h-3 w-px bg-line sm:block" />
            {stateLine}
          </>
        )}
      </div>

      {/* Mobile deadline */}
      {deadlineMeta && (
        <div className="mt-2 flex items-center justify-between sm:hidden">
          <span className="micro">{deadlineLabel ?? "Deadline"}</span>
          {deadlineMeta}
        </div>
      )}

      {urgency === "expired" && deadline && (
        <div className="mt-2 text-[11px] text-faint">
          {task.status === Status.Created
            ? "Accept window elapsed — the requester can reclaim the escrow."
            : task.status === Status.Accepted
              ? "Work deadline elapsed — the requester can refund the escrow."
              : "Review window elapsed — the escrow can be paid out."}
        </div>
      )}
    </Link>
  );
}
