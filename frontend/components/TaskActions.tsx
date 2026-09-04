"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { writeGasless, myIdentity, fetchCancellationApprovals, type CancellationState } from "@/lib/tasks";
import { bundlerUrl } from "@/lib/aa";
import { Status } from "@/lib/contract";
import { shortAddress, explorerTx, looksLikeUrl } from "@/lib/format";
import { AlertTriangle, ArrowUpRight, Bolt, Check } from "./icons";
import type { TaskView, DisputeView } from "@/lib/types";

function ActionButton({
  label,
  onClick,
  busy,
  disabled,
  tone = "default",
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger" | "success";
}) {
  const cls =
    tone === "danger" ? "btn-danger" : tone === "success" ? "btn-success" : "btn-secondary";
  return (
    <button onClick={onClick} disabled={busy || disabled} className={cls}>
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />
      )}
      {busy ? "Confirming…" : label}
      {!busy && (
        <span className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          <Bolt size={9} /> 0 gas
        </span>
      )}
    </button>
  );
}

function ConfirmedTx({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="banner-ok !py-2.5">
      <Check size={15} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label} confirmed</span>{" "}
        <span className="font-mono text-xs opacity-70">
          {hash.slice(0, 10)}…{hash.slice(-6)}
        </span>
      </span>
      <a
        href={explorerTx(hash)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-xs underline-offset-2 hover:underline"
      >
        View transaction <ArrowUpRight size={12} />
      </a>
    </div>
  );
}

export default function TaskActions({
  task,
  dispute,
  onSettled,
}: {
  task: TaskView;
  dispute: DisputeView | null;
  onSettled: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smart, setSmart] = useState<string | null>(null);

  const [submitText, setSubmitText] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [challengeReason, setChallengeReason] = useState("");
  const [rating, setRating] = useState(5);
  const [cancelApprovals, setCancelApprovals] = useState<CancellationState | null>(null);

  const [confirmed, setConfirmed] = useState<{ label: string; hash: string } | null>(null);

  const bundlerOnline = Boolean(bundlerUrl());

  useEffect(() => {
    let alive = true;
    if (!isConnected || !address) {
      setSmart(null);
      return;
    }
    myIdentity()
      .then(({ smart: s }) => alive && setSmart(s))
      .catch(() => alive && setSmart(null));
    return () => {
      alive = false;
    };
  }, [isConnected, address]);

  const canMutualCancel =
    (task.status === Status.Accepted || task.status === Status.Submitted) && smart;

  // Mutual cancellation needs each party's on-chain approval flag. There is no
  // public getter, so derive it from CancellationApproval logs.
  useEffect(() => {
    let alive = true;
    if (!canMutualCancel) {
      setCancelApprovals(null);
      return;
    }
    fetchCancellationApprovals(task.taskId, task.requester, task.agent)
      .then((s) => alive && setCancelApprovals(s))
      .catch(() => alive && setCancelApprovals(null));
    return () => {
      alive = false;
    };
  }, [canMutualCancel, task]);

  if (!isConnected || !address) {
    return (
      <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-[13px] text-faint">
        Connect your wallet to act on this task. You will only be asked to sign.
      </p>
    );
  }

  const me = address.toLowerCase();
  const meSmart = smart?.toLowerCase() ?? null;
  const requester = task.requester.toLowerCase();
  const agent = task.agent.toLowerCase();

  const isRequester = requester === meSmart;
  const isAgent = agent === meSmart;
  const legacyBlocked =
    meSmart !== null && !isRequester && !isAgent && (requester === me || agent === me);

  function act(name: string, fnName: Parameters<typeof writeGasless>[0], args: unknown[]) {
    setBusy(name);
    setError(null);
    setConfirmed(null);
    writeGasless(fnName, args)
      .then((res) => {
        setConfirmed({ label: name, hash: res.hash });
        onSettled();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  function losingParty(): "requester" | "agent" | null {
    if (!dispute) return null;
    return dispute.tentativeApproved ? "requester" : "agent";
  }
  const challenger = losingParty();
  const canChallenge = challenger !== null && (challenger === "requester" ? isRequester : isAgent);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const inputCls = "input !py-1.5 text-[13px]";

  return (
    <div className="space-y-3.5">
      {!bundlerOnline && (
        <div className="banner-warn">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>The sponsor bundler is offline — actions resume when the oracle is running.</span>
        </div>
      )}
      {legacyBlocked && (
        <div className="banner-neutral">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            This task binds your wallet address directly (as {requester === me ? "requester" : "agent"})
            rather than your TaskPay account. TaskPay is gasless-only now, so this earlier task
            can&apos;t be acted on from the app — new tasks bind accounts and work fully gasless.
          </span>
        </div>
      )}
      {error && (
        <div className="banner-bad">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {confirmed && <ConfirmedTx label={confirmed.label} hash={confirmed.hash} />}

      {/* Created: agent accepts */}
      {task.status === Status.Created && isAgent && bundlerOnline && (
        <ActionButton
          tone="success"
          label="Accept task"
          busy={busy === "accept"}
          onClick={() => act("accept", "acceptTask", [task.taskId])}
        />
      )}

      {/* Created: requester can back out */}
      {task.status === Status.Created && isRequester && bundlerOnline && (
        <div className="space-y-2.5">
          {now < task.acceptDeadline ? (
            <>
              <p className="text-[13px] text-mute">
                The agent hasn&apos;t accepted yet. Cancel anytime — the escrow is refunded in full.
              </p>
              <ActionButton
                tone="danger"
                label="Cancel task and refund escrow"
                busy={busy === "cancel"}
                onClick={() => act("cancel", "cancelOpenTask", [task.taskId])}
              />
            </>
          ) : (
            <>
              <p className="text-[13px] text-bad">
                The accept window has closed — the agent can no longer accept. Reclaim the escrow.
              </p>
              <ActionButton
                tone="danger"
                label="Reclaim escrow"
                busy={busy === "reclaim"}
                onClick={() => act("reclaim", "reclaimAfterDeadline", [task.taskId])}
              />
            </>
          )}
        </div>
      )}

      {/* Accepted: agent submits */}
      {task.status === Status.Accepted && isAgent && bundlerOnline && (
        <div className="space-y-2.5">
          <div>
            <label className="label">Deliverable</label>
            <textarea
              rows={3}
              className={inputCls}
              placeholder="Repo URL + commit, artifact link, or a summary of what was shipped"
              value={submitText}
              onChange={(e) => setSubmitText(e.target.value)}
            />
            {submitText.trim() && !looksLikeUrl(submitText.trim()) && (
              <p className="mt-1 text-[11px] text-warn">
                Tip: include a link — the AI reviewer fetches it during disputes.
              </p>
            )}
          </div>
          <ActionButton
            tone="success"
            label="Submit deliverable"
            busy={busy === "submit"}
            disabled={!submitText.trim()}
            onClick={() => act("submit", "submitWork", [task.taskId, submitText.trim()])}
          />
        </div>
      )}

      {/* Submitted: requester releases or disputes */}
      {task.status === Status.Submitted && isRequester && bundlerOnline && (
        <div className="space-y-3">
          <ActionButton
            tone="success"
            label="Release payment to agent"
            busy={busy === "release"}
            onClick={() => act("release", "release", [task.taskId])}
          />
          <div className="space-y-2.5 rounded-lg border border-bad-line bg-subtle p-3.5">
            <div>
              <label className="label !text-bad">Not satisfied? Raise a dispute</label>
              <textarea
                rows={3}
                className={`${inputCls} !border-bad-line`}
                placeholder="What is wrong with the deliverable — e.g. nothing shipped, requirements missed"
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-faint">
              Your reason is archived and shown on the task page; the AI quorum rules on the full
              deliverable.
            </p>
            <ActionButton
              tone="danger"
              label="Raise dispute"
              busy={busy === "dispute"}
              disabled={!disputeReason.trim()}
              onClick={() => act("dispute", "raiseDispute", [task.taskId, disputeReason.trim()])}
            />
          </div>
        </div>
      )}

      {/* Disputed: anyone can apply a 2-of-3 verdict */}
      {task.status === Status.Disputed && bundlerOnline && (
        <div>
          <ActionButton
            label="Apply quorum verdict"
            busy={busy === "resolve"}
            onClick={() => act("resolve", "resolveDispute", [task.taskId])}
          />
          <p className="mt-1.5 text-[11px] text-faint">
            Once two AI agents agree, anyone can apply the ruling on-chain — sponsored.
          </p>
        </div>
      )}

      {/* PendingChallenge */}
      {task.status === Status.PendingChallenge && dispute && bundlerOnline && (
        <div className="space-y-2.5">
          {now > dispute.challengeDeadline && (
            <ActionButton
              tone="success"
              label="Finalize — challenge window passed"
              busy={busy === "finalize"}
              onClick={() => act("finalize", "finalizeAfterChallenge", [task.taskId])}
            />
          )}
          {canChallenge && now <= dispute.challengeDeadline && (
            <div className="space-y-2.5 rounded-lg border border-fu-line bg-subtle p-3.5">
              <div>
                <label className="label !text-fu">Appeal to the Senior Arbiter</label>
                <textarea
                  rows={3}
                  className={`${inputCls} !border-fu-line`}
                  placeholder="Why should the Senior Arbiter overturn the quorum ruling?"
                  value={challengeReason}
                  onChange={(e) => setChallengeReason(e.target.value)}
                />
              </div>
              <ActionButton
                tone="danger"
                label="Challenge the ruling"
                busy={busy === "challenge"}
                disabled={!challengeReason.trim()}
                onClick={() =>
                  act("challenge", "challenge", [
                    task.taskId,
                    keccak256(toHex(challengeReason.trim())),
                  ])
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Released: requester rates the agent */}
      {task.status === Status.Released && isRequester && bundlerOnline && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-line bg-well px-4 py-3">
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                disabled={busy === "rate"}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                className={`transition hover:scale-110 disabled:opacity-50 ${
                  n <= rating ? "text-amber-500" : "text-faint hover:text-mute"
                }`}
              >
                <StarFilled />
              </button>
            ))}
          </div>
          <span className="text-[13px] text-mute">Rate the agent</span>
          <ActionButton
            label={`Submit ${rating} of 5`}
            busy={busy === "rate"}
            onClick={() => act("rate", "rateAgent", [task.taskId, rating])}
          />
        </div>
      )}

      {/* Mutual cancellation (Accepted/Submitted): both parties must agree */}
      {canMutualCancel && (isRequester || isAgent) && bundlerOnline && (() => {
        const myApproved = isRequester
          ? (cancelApprovals?.requester ?? false)
          : (cancelApprovals?.agent ?? false);
        const otherApproved = isRequester
          ? (cancelApprovals?.agent ?? false)
          : (cancelApprovals?.requester ?? false);
        const otherRole = isRequester ? "the agent" : "the requester";

        if (!myApproved && !otherApproved) {
          return (
            <div className="rounded-lg border border-line bg-subtle p-3.5">
              <p className="text-[13px] leading-relaxed text-mute">
                Both parties must agree to cancel — the escrow returns to the requester in full
                and {otherRole} is released from the task.
              </p>
              <div className="mt-2.5">
                <ActionButton
                  label="Request mutual cancellation"
                  busy={busy === "request cancel"}
                  onClick={() => act("request cancel", "setCancellationApproval", [task.taskId, true])}
                />
              </div>
            </div>
          );
        }
        if (!myApproved && otherApproved) {
          return (
            <div className="space-y-2.5 rounded-lg border border-warn-line bg-warn-soft p-3.5">
              <p className="text-[13px] text-fg">
                {otherRole === "the requester" ? "The requester" : "The agent"} has requested
                cancellation. Approving refunds the escrow to the requester and closes the task.
              </p>
              <ActionButton
                tone="danger"
                label="Approve cancellation — refund escrow"
                busy={busy === "approve cancel"}
                onClick={() => act("approve cancel", "setCancellationApproval", [task.taskId, true])}
              />
            </div>
          );
        }
        return (
          <div className="rounded-lg border border-line bg-subtle p-3.5">
            <p className="text-[13px] text-mute">
              You proposed cancellation — waiting for {otherRole} to approve. You can withdraw
              your request while it is pending.
            </p>
            <div className="mt-2.5">
              <ActionButton
                label="Withdraw cancellation request"
                busy={busy === "withdraw request"}
                onClick={() => act("withdraw request", "setCancellationApproval", [task.taskId, false])}
              />
            </div>
          </div>
        );
      })()}

      {bundlerOnline && smart && (
        <p className="text-[11px] text-faint">
          Acting as <span className="font-mono">{shortAddress(smart)}</span> — no wallet
          transaction is broadcast; actions are sponsored UserOps you only sign.
        </p>
      )}
    </div>
  );
}

function StarFilled() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.8 14.9 8.6l6.4.9-4.6 4.5 1.1 6.3L12 17.4l-5.7 3 1.1-6.3L2.7 9.5l6.4-.9L12 2.8Z" />
    </svg>
  );
}
