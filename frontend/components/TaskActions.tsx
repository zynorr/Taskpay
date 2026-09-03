"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, toHex } from "viem";
import { writeContract, writeGasless, myIdentity } from "@/lib/tasks";
import { bundlerUrl } from "@/lib/aa";
import { Status } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
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
      className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
    >
      {busy ? "Waiting…" : label}
      {gasless && !busy && <span className="ml-1.5 text-[10px] font-bold text-emerald-300">⚡gasless</span>}
    </button>
  );
}

/**
 * Task lifecycle actions. Two identities can act on a task:
 *   - the connected EOA directly (classic flow), and
 *   - the EOA's SimpleAccount (gasless flow — roles on-chain are the smart
 *     account address when the task was created through the sponsor bundler).
 *
 * The right path is chosen by which address matches the role on the task; when
 * gasless is used the wallet only signs a UserOp hash and the oracle's paymaster
 * covers the fee.
 */
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
    return <p className="text-sm text-slate-500">Connect your wallet to take actions.</p>;
  }

  const me = address.toLowerCase();
  const meSmart = smart?.toLowerCase() ?? null;
  const requester = task.requester.toLowerCase();
  const agent = task.agent.toLowerCase();

  // Which of our identities is the requester / agent on this task?
  const requesterRole = requester === me ? ("eoa" as const) : requester === meSmart ? ("smart" as const) : null;
  const agentRole = agent === me ? ("eoa" as const) : agent === meSmart ? ("smart" as const) : null;
  const isRequester = requesterRole !== null;
  const isAgent = agentRole !== null && !isRequester;

  /** Run a write through whichever identity matches; gasless when the smart account is the actor. */
  function act(name: string, fnName: Parameters<typeof writeContract>[0], args: unknown[], opts?: { value?: bigint }) {
    setBusy(name);
    setError(null);
    const actor =
      name === "accept" || name === "submit" ? agentRole : name === "challenge" ? challengeRole() : requesterRole;
    const viaGasless = actor === "smart" && gaslessOn;
    (viaGasless ? writeGasless(fnName, args, opts) : writeContract(fnName, args, opts))
      .then(() => onSettled())
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  }

  // The losing party challenges: agent when the tentative is a reject, requester when approve.
  function challengeRole(): "eoa" | "smart" | null {
    if (!dispute) return null;
    return dispute.tentativeApproved ? requesterRole : agentRole;
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const gaslessAvailable = gaslessOn && (smart !== null);

  return (
    <div className="space-y-3">
      {gaslessAvailable && (
        <p className="text-xs text-emerald-400/80">
          Gasless mode on — actions you own via your smart account ({smart ? shortAddress(smart) : ""}) are
          sponsored by the TaskPay oracle. You only sign.
        </p>
      )}
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
            gasless={agentRole === "smart" && gaslessOn}
            onClick={() => act("accept", "acceptTask", [task.taskId])}
          />
        )}

        {/* Accepted: agent submits deliverable */}
        {task.status === Status.Accepted && isAgent && (
          <ActionButton
            label="Submit deliverable"
            busy={busy === "submit"}
            gasless={agentRole === "smart" && gaslessOn}
            onClick={() =>
              act("submit", "submitWork", [task.taskId, "submitted via TaskPay UI"])
            }
          />
        )}

        {/* Submitted: requester releases or disputes */}
        {task.status === Status.Submitted && isRequester && (
          <>
            <ActionButton
              tone="success"
              label="Release payment"
              busy={busy === "release"}
              gasless={requesterRole === "smart" && gaslessOn}
              onClick={() => act("release", "release", [task.taskId])}
            />
            <ActionButton
              tone="danger"
              label="Raise dispute"
              busy={busy === "dispute"}
              gasless={requesterRole === "smart" && gaslessOn}
              onClick={() =>
                act("dispute", "raiseDispute", [task.taskId, "Disputed via TaskPay UI"])
              }
            />
          </>
        )}

        {/* Disputed: anyone resolves once 2-of-3 exists */}
        {task.status === Status.Disputed && (
          <ActionButton
            label="Resolve dispute (2-of-3)"
            busy={busy === "resolve"}
            onClick={() => act("resolve", "resolveDispute", [task.taskId])}
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
                onClick={() => act("finalize", "finalizeAfterChallenge", [task.taskId])}
              />
            )}
            {challengeRole() !== null && now <= dispute.challengeDeadline && (
              <ActionButton
                tone="danger"
                label="Challenge to Senior Arbiter"
                busy={busy === "challenge"}
                gasless={challengeRole() === "smart" && gaslessOn}
                onClick={() =>
                  act("challenge", "challenge", [
                    task.taskId,
                    keccak256(toHex("challenged via TaskPay UI")),
                  ])
                }
              />
            )}
          </>
        )}

        {/* Released: requester rates the agent */}
        {task.status === Status.Released && isRequester && (
          <ActionButton
            label="Rate agent 5★"
            busy={busy === "rate"}
            gasless={requesterRole === "smart" && gaslessOn}
            onClick={() => act("rate", "rateAgent", [task.taskId, 5])}
          />
        )}
      </div>

      {busy && <p className="text-xs text-slate-500">Transaction pending…</p>}
      {isAgent && task.status === Status.Accepted && (
        <p className="text-xs text-slate-600">
          The UI submits a placeholder deliverable string. Real usage pins a repo URL + commit SHA
          (the oracle fetches it for AI review).
        </p>
      )}
    </div>
  );
}
