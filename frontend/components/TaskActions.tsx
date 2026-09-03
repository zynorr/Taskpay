"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { writeContract, writeGasless, myIdentity } from "@/lib/tasks";
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
  gasless,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger" | "success";
  gasless?: boolean;
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
      {gasless && !busy && (
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
  const [gaslessOn, setGaslessOn] = useState(false);

  // Form inputs for multi-field actions
  const [submitText, setSubmitText] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [challengeReason, setChallengeReason] = useState("");
  const [rating, setRating] = useState(5);

  // Last confirmed action → explorer link
  const [confirmed, setConfirmed] = useState<{ label: string; hash: string } | null>(null);

  useEffect(() => {
    let alive = true;
    if (!isConnected || !address) {
      setSmart(null);
      return;
    }
    setGaslessOn(Boolean(bundlerUrl()));
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

  const requesterRole = requester === me ? ("eoa" as const) : requester === meSmart ? ("smart" as const) : null;
  const agentRole = agent === me ? ("eoa" as const) : agent === meSmart ? ("smart" as const) : null;
  const isRequester = requesterRole !== null;
  const isAgent = agentRole !== null && !isRequester;

  function act(name: string, fnName: Parameters<typeof writeContract>[0], args: unknown[], opts?: { value?: bigint }) {
    setBusy(name);
    setError(null);
    setConfirmed(null);
    const actor =
      name === "accept" || name === "submit" ? agentRole : name === "challenge" ? challengeRole() : requesterRole;
    const viaGasless = actor === "smart" && gaslessOn;
    (viaGasless ? writeGasless(fnName, args, opts) : writeContract(fnName, args, opts))
      .then((res) => {
        setConfirmed({ label: name, hash: res.hash });
        onSettled();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  function challengeRole(): "eoa" | "smart" | null {
    if (!dispute) return null;
    return dispute.tentativeApproved ? requesterRole : agentRole;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const gaslessAvailable = gaslessOn && smart !== null;

  const inputCls =
    "input !py-1.5 text-xs";

  return (
    <div className="space-y-3">
      {gaslessAvailable && (
        <p className="text-xs text-emerald-400/80">
          ⚡ Gasless is on — actions you own via your smart account (
          <span className="font-mono">{smart ? shortAddress(smart) : ""}</span>) are sponsored by the
          TaskPay oracle. You only sign, never pay gas.
        </p>
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

      {/* Created: designated agent accepts */}
      {task.status === Status.Created && isAgent && (
        <ActionButton
          tone="success"
          label="Accept task"
          busy={busy === "accept"}
          gasless={agentRole === "smart" && gaslessOn}
          onClick={() => act("accept", "acceptTask", [task.taskId])}
        />
      )}

      {/* Accepted: agent submits deliverable */}
      {task.status === Status.Accepted && isAgent && (
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
            gasless={agentRole === "smart" && gaslessOn}
            onClick={() => act("submit", "submitWork", [task.taskId, submitText.trim()])}
          />
        </div>
      )}

      {/* Submitted: requester releases or disputes */}
      {task.status === Status.Submitted && isRequester && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <ActionButton
              tone="success"
              label="Release payment"
              busy={busy === "release"}
              gasless={requesterRole === "smart" && gaslessOn}
              onClick={() => act("release", "release", [task.taskId])}
            />
          </div>
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
              gasless={requesterRole === "smart" && gaslessOn}
              onClick={() => act("dispute", "raiseDispute", [task.taskId, disputeReason.trim()])}
            />
          </div>
        </div>
      )}

      {/* Disputed: anyone resolves once 2-of-3 exists */}
      {task.status === Status.Disputed && (
        <div>
          <ActionButton
            label="Resolve dispute (apply 2-of-3 verdict)"
            busy={busy === "resolve"}
            onClick={() => act("resolve", "resolveDispute", [task.taskId])}
          />
          <p className="mt-1.5 text-[11px] text-slate-600">
            Once two AI agents agree, anyone can apply the ruling on-chain.
          </p>
        </div>
      )}

      {/* PendingChallenge: losing party challenges within the window */}
      {task.status === Status.PendingChallenge && dispute && (
        <div className="space-y-2">
          {now > dispute.challengeDeadline && (
            <ActionButton
              tone="success"
              label="Finalize (challenge window passed)"
              busy={busy === "finalize"}
              onClick={() => act("finalize", "finalizeAfterChallenge", [task.taskId])}
            />
          )}
          {challengeRole() !== null && now <= dispute.challengeDeadline && (
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
                gasless={challengeRole() === "smart" && gaslessOn}
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
      {task.status === Status.Released && isRequester && (
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
            gasless={requesterRole === "smart" && gaslessOn}
            onClick={() => act("rate", "rateAgent", [task.taskId, rating])}
          />
        </div>
      )}
    </div>
  );
}