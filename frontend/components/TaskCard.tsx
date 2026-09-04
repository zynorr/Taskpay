"use client";

import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { ArrowRight, Clock } from "./icons";
import { shortAddress, formatAmount, timeLeft, deadlineUrgency, explorerAddress } from "@/lib/format";
import { Status } from "@/lib/contract";
import type { TaskView, DisputeView } from "@/lib/types";

const URGENCY: Record<string, string> = {
  ok: "text-mute",
  soon: "text-warn",
  critical: "text-warn2",
  expired: "text-bad",
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

  return (
    <Link href={`/task/${task.taskId}`} className="card-link group p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        {/* Identity side */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm font-semibold text-fg tnum">
              #{task.taskId.toString().padStart(3, "0")}
            </span>
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
            <StatusBadge status={task.status} pulse={disputePhase} />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
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
            <a
              href={explorerAddress(task.agent)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-mute transition hover:text-accent"
              title="Agent"
            >
              {shortAddress(task.agent)}
            </a>
            {stateLine}
          </div>
        </div>

        {/* Numbers side */}
        <div className="flex items-center justify-end gap-x-8 gap-y-2">
          <div className="text-right">
            <div className="micro">Escrow</div>
            <div className="mt-0.5 text-[15px] font-semibold text-fg tnum">
              {formatAmount(task.amount)}
              <span className="ml-1 text-xs font-normal text-mute">BOT</span>
            </div>
          </div>
          {deadlineMeta && (
            <div className="hidden text-right sm:block">
              <div className="micro">
                {task.status === Status.Created
                  ? "Accept window"
                  : task.status === Status.Accepted
                    ? "Work deadline"
                    : "Review window"}
              </div>
              <div className="mt-0.5">{deadlineMeta}</div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile deadline */}
      {deadlineMeta && (
        <div className="mt-3 flex items-center justify-between border-t border-lineSoft pt-3 sm:hidden">
          <span className="micro">
            {task.status === Status.Created
              ? "Accept window"
              : task.status === Status.Accepted
                ? "Work deadline"
                : "Review window"}
          </span>
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
