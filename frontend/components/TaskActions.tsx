"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { writeContract } from "@/lib/tasks";
import { Status } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
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
      className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
    >
      {busy ? "Waiting for tx…" : label}
    </button>
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

  if (!isConnected || !address) {
    return <p className="text-sm text-slate-500">Connect your wallet to take actions.</p>;
  }

  const me = address.toLowerCase();
  const requester = task.requester.toLowerCase() === me;
  const agent = task.agent.toLowerCase() === me;
  const isAgent = agent && !requester;

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      onSettled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const now = BigInt(Math.floor(Date.now() / 1000));

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Created: designated agent accepts */}
        {task.status === Status.Created && isAgent && (
          <ActionButton
            tone="success"
            label="Accept task"
            busy={busy === "accept"}
            onClick={() => act("accept", () => writeContract("acceptTask", [task.taskId]))}
          />
        )}

        {/* Accepted: agent submits deliverable */}
        {task.status === Status.Accepted && isAgent && (
          <ActionButton
            label="Submit deliverable"
            busy={busy === "submit"}
            onClick={() => act("submit", () => writeContract("submitWork", [task.taskId, "submitted via TaskPay UI"]))}
          />
        )}

        {/* Submitted: requester releases or disputes */}
        {task.status === Status.Submitted && requester && (
          <>
            <ActionButton
              tone="success"
              label="Release payment"
              busy={busy === "release"}
              onClick={() => act("release", () => writeContract("release", [task.taskId]))}
            />
            <ActionButton
              tone="danger"
              label="Raise dispute"
              busy={busy === "dispute"}
              onClick={() =>
                act("dispute", () =>
                  writeContract("raiseDispute", [task.taskId, "Disputed via TaskPay UI"]),
                )
              }
            />
          </>
        )}

        {/* Disputed: anyone resolves once 2-of-3 exists */}
        {task.status === Status.Disputed && (
          <ActionButton
            label="Resolve dispute (2-of-3)"
            busy={busy === "resolve"}
            onClick={() => act("resolve", () => writeContract("resolveDispute", [task.taskId]))}
          />
        )}

        {/* PendingChallenge: losing party challenges within the window */}
        {task.status === Status.PendingChallenge && dispute && (
          <>
            {now > dispute.challengeDeadline && (
              <ActionButton
                tone="success"
                label="Finalize (window passed)"
                busy={busy === "finalize"}
                onClick={() => act("finalize", () => writeContract("finalizeAfterChallenge", [task.taskId]))}
              />
            )}
            {isAgent && dispute.tentativeApproved === false && now <= dispute.challengeDeadline && (
              <ActionButton
                tone="danger"
                label="Challenge to Senior Arbiter"
                busy={busy === "challenge"}
                onClick={() =>
                  act("challenge", () =>
                    writeContract("challenge", [
                      task.taskId,
                      keccak256(toHex("challenged via TaskPay UI")),
                    ]),
                  )
                }
              />
            )}
            {requester && dispute.tentativeApproved === true && now <= dispute.challengeDeadline && (
              <ActionButton
                tone="danger"
                label="Challenge to Senior Arbiter"
                busy={busy === "challenge"}
                onClick={() =>
                  act("challenge", () =>
                    writeContract("challenge", [
                      task.taskId,
                      keccak256(toHex("challenged via TaskPay UI")),
                    ]),
                  )
                }
              />
            )}
          </>
        )}

        {/* Released: requester rates the agent */}
        {task.status === Status.Released && requester && (
          <ActionButton
            label="Rate agent 5★"
            busy={busy === "rate"}
            onClick={() => act("rate", () => writeContract("rateAgent", [task.taskId, 5]))}
          />
        )}
      </div>

      {busy && <p className="text-xs text-slate-500">Transaction pending — check your wallet…</p>}
      {isAgent && task.status === Status.Accepted && (
        <p className="text-xs text-slate-600">
          The UI submits a placeholder deliverable string. Real usage pins a repo URL + commit SHA
          (the oracle fetches it for AI review).
        </p>
      )}
    </div>
  );
}