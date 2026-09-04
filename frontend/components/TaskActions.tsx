"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { writeGasless, myIdentity } from "@/lib/tasks";
import { bundlerUrl } from "@/lib/aa";
import { Status } from "@/lib/contract";
import { shortAddress, explorerTx, looksLikeUrl } from "@/lib/format";
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
  const toneCls =
    tone === "danger"
      ? "bg-rose-700 hover:bg-rose-600"
      : tone === "success"
        ? "bg-emerald-700 hover:bg-emerald-600"
        : "bg-slate-700 hover:bg-slate-600";
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
    >
      {busy && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      )}
      {busy ? "Confirming…" : label}
      {!busy && (
        <span className="rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200">
          ⚡ gasless
        </span>
      )}
    </button>
  );
}

function CopyHash({ hash }: { hash: string }) {
  return (
    <span className="font-mono text-[11px] text-slate-500">
      {hash.slice(0, 10)}…{hash.slice(-6)}
    </span>
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

  // Form inputs for multi-field actions
  const [submitText, setSubmitText] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [challengeReason, setChallengeReason] = useState("");
  const [rating, setRating] = useState(5);

  // Last confirmed action → explorer link
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

  if (!isConnected || !address) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-5 text-center text-sm text-slate-500">
        Connect your wallet to take actions on this task.
      </div>
    );
  }

  const me = address.toLowerCase();
  const meSmart = smart?.toLowerCase() ?? null;
  const requester = task.requester.toLowerCase();
  const agent = task.agent.toLowerCase();

  // Gasless-only: an action is only possible when the on-chain role IS the
  // connected wallet's TaskPay account (sponsored UserOps run as that account).
  const isRequester = requester === meSmart;
  const isAgent = agent === meSmart;

  // Legacy tasks may name the raw wallet instead of its TaskPay account —
  // those roles can no longer be acted on from the gasless-only app.
  const legacyBlocked =
    meSmart !== null && !isRequester && !isAgent && (requester === me || agent === me);

  function act(name: string, fnName: Parameters<typeof writeGasless>[0], args: unknown[], opts?: { value?: bigint }) {
    setBusy(name);
    setError(null);
    setConfirmed(null);
    writeGasless(fnName, args, opts)
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
  const inputCls = "input !py-1.5 text-xs";

  return (
    <div className="space-y-3">
      {!bundlerOnline && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-300">
          The sponsor bundler is offline — actions are unavailable until the oracle is running.
        </div>
      )}
      {legacyBlocked && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500">
          This task was created with your wallet address directly as the{" "}
          {requester === me ? "requester" : "agent"}, not your TaskPay account. TaskPay is
          gasless-only now, so this legacy task can&apos;t be acted on from the app — new tasks bind
          the TaskPay account and work fully gasless.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {confirmed && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          <span>✓ {confirmed.label} confirmed</span>
          <CopyHash hash={confirmed.hash} />
          <a
            href={explorerTx(confirmed.hash)}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-200 underline-offset-2 hover:underline"
          >
            view on explorer ↗
          </a>
        </div>
      )}

      {!bundlerOnline && (
        <p className="text-[11px] text-slate-600">
          Connected as <span className="font-mono">{shortAddress(smart ?? address)}</span> — no
          wallet transaction is ever broadcast; actions are sponsored UserOps.
        </p>
      )}

      {/* Created: designated agent accepts */}
      {task.status === Status.Created && isAgent && bundlerOnline && (
        <ActionButton
          tone="success"
          label="Accept task"
          busy={busy === "accept"}
          onClick={() => act("accept", "acceptTask", [task.taskId])}
        />
      )}

      {/* Created: requester can back out anytime — cancel (window open) or
          reclaim (window passed, agent can no longer accept) */}
      {task.status === Status.Created && isRequester && bundlerOnline && (
        <div className="space-y-2">
          {now < task.acceptDeadline ? (
            <>
              <p className="text-[11px] text-slate-600">
                The agent hasn&apos;t accepted yet. You can cancel anytime and the escrow is refunded
                in full — no fee.
              </p>
              <ActionButton
                tone="danger"
                label="Cancel task & refund escrow"
                busy={busy === "cancel"}
                onClick={() => act("cancel", "cancelOpenTask", [task.taskId])}
              />
            </>
          ) : (
            <>
              <p className="text-[11px] text-rose-300/80">
                The accept window has passed — the agent can no longer accept. Reclaim the escrow.
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

      {/* Accepted: agent submits deliverable */}
      {task.status === Status.Accepted && isAgent && bundlerOnline && (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <label className="block text-xs font-medium text-slate-400">
            Deliverable <span className="text-slate-600">(repo URL, commit SHA, or text)</span>
          </label>
          <textarea
            rows={2}
            className={inputCls}
            placeholder="https://github.com/you/repo @ <commit-sha>"
            value={submitText}
            onChange={(e) => setSubmitText(e.target.value)}
          />
          {submitText.trim() && !looksLikeUrl(submitText.trim()) && (
            <p className="text-[11px] text-amber-400/80">
              Tip: include a link — the AI reviewer fetches it during disputes.
            </p>
          )}
          <ActionButton
            label="Submit deliverable"
            busy={busy === "submit"}
            disabled={!submitText.trim()}
            onClick={() => act("submit", "submitWork", [task.taskId, submitText.trim()])}
          />
        </div>
      )}

      {/* Submitted: requester releases or disputes */}
      {task.status === Status.Submitted && isRequester && bundlerOnline && (
        <div className="space-y-2">
          <ActionButton
            tone="success"
            label="Release payment"
            busy={busy === "release"}
            onClick={() => act("release", "release", [task.taskId])}
          />
          <div className="space-y-2 rounded-xl border border-rose-900/40 bg-rose-950/20 p-3">
            <label className="block text-xs font-medium text-rose-300">
              Not satisfied? Raise a dispute <span className="font-normal text-rose-400/70">(AI quorum rules)</span>
            </label>
            <textarea
              rows={2}
              className={`${inputCls} border-rose-900/50 focus:border-rose-500`}
              placeholder="What's wrong with the deliverable? e.g. no code shipped, missed requirements…"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
            />
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

      {/* Disputed: anyone resolves once 2-of-3 exists */}
      {task.status === Status.Disputed && bundlerOnline && (
        <div>
          <ActionButton
            label="Resolve dispute (apply 2-of-3 verdict)"
            busy={busy === "resolve"}
            onClick={() => act("resolve", "resolveDispute", [task.taskId])}
          />
          <p className="mt-1.5 text-[11px] text-slate-600">
            Once two AI agents agree, anyone can apply the ruling on-chain — sponsored, 0 gas.
          </p>
        </div>
      )}

      {/* PendingChallenge: losing party challenges within the window */}
      {task.status === Status.PendingChallenge && dispute && bundlerOnline && (
        <div className="space-y-2">
          {now > dispute.challengeDeadline && (
            <ActionButton
              tone="success"
              label="Finalize (challenge window passed)"
              busy={busy === "finalize"}
              onClick={() => act("finalize", "finalizeAfterChallenge", [task.taskId])}
            />
          )}
          {canChallenge && now <= dispute.challengeDeadline && (
            <div className="space-y-2 rounded-xl border border-violet-900/40 bg-violet-950/20 p-3">
              <label className="block text-xs font-medium text-violet-300">
                You lost the quorum ruling — appeal to the Senior Arbiter
              </label>
              <textarea
                rows={2}
                className={`${inputCls} border-violet-900/50 focus:border-violet-500`}
                placeholder="Why should the Senior Arbiter overturn the quorum?"
                value={challengeReason}
                onChange={(e) => setChallengeReason(e.target.value)}
              />
              <ActionButton
                tone="danger"
                label="Challenge to Senior Arbiter"
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
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => setRating(n)}
                disabled={busy === "rate"}
                aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
                className={`text-xl transition hover:scale-110 disabled:opacity-50 ${
                  n <= rating ? "text-amber-400" : "text-slate-700 hover:text-slate-500"
                }`}
              >
                ★
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">Rate the agent</span>
          <ActionButton
            label={`Submit ${rating}★`}
            busy={busy === "rate"}
            onClick={() => act("rate", "rateAgent", [task.taskId, rating])}
          />
        </div>
      )}
    </div>
  );
}
