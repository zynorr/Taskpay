import { getTask, getVerdict, type VerdictView } from "../contract/reads.js";
import { Status, AgentRole } from "../contract/client.js";
import { buildTaskContext } from "./context.js";
import { reviewerAgent, fraudSanityAgent, arbiterAgent, type AgentVerdict } from "../agents/index.js";
import { submitAgentVerdict } from "../verdict/submit.js";
import { insertDisputeReason } from "../store/disputes.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { DisputeRaisedEvent } from "../contract/events.js";

// The requester disputed a submitted deliverable within the review window.
// Judge-first model: the AI quorum runs only here (normal, undisputed tasks
// never pay oracle/AI costs). Three roles vote 2-of-3; the Arbiter is only
// called when Reviewer and FraudSanity disagree (contract design). The AI
// calls (expensive, no wallet interaction) run in parallel; on-chain verdict
// submissions are serialized by the shared tx lock in verdict/submit.ts
// (single oracle wallet, nonce safety).
export async function handleDisputeRaised(event: DisputeRaisedEvent): Promise<void> {
  const taskId = event.taskId;
  const logCtx = { taskId: taskId.toString() };
  try {
    logger.info("dispute_raised_received", { ...logCtx, requester: event.requester, block: event.blockNumber });

    const task = await getTask(taskId);
    if (task.status !== Status.Disputed) {
      logger.info("dispute_skip_wrong_status", { ...logCtx, status: task.status });
      return;
    }

    // Archive the requester's human-readable reason (off-chain, first write
    // wins). The frontend serves it back from the shared data dir, so the
    // detail page can explain why the AI pipeline is running.
    try {
      await insertDisputeReason({
        chain_id: env.CHAIN_ID,
        task_id: Number(taskId),
        requester: event.requester,
        reason: event.reason,
        block_number: event.blockNumber,
        transaction_hash: event.transactionHash,
      });
    } catch (err) {
      logger.warn("dispute_reason_archive_failed", { ...logCtx, error: String(err) });
    }

    const existing = {
      reviewer: await getVerdict(taskId, AgentRole.Reviewer),
      fraud: await getVerdict(taskId, AgentRole.FraudSanity),
      arbiter: await getVerdict(taskId, AgentRole.Arbiter),
    };

    const bothReviewersDone = existing.reviewer.hasVoted && existing.fraud.hasVoted;
    const reviewersAgree = existing.reviewer.hasVoted && existing.fraud.hasVoted && existing.reviewer.approved === existing.fraud.approved;
    if (bothReviewersDone && (reviewersAgree || existing.arbiter.hasVoted)) {
      logger.info("dispute_skip_already_complete", logCtx);
      await tryResolveIfConsensus(taskId);
      return;
    }

    const { context } = await buildTaskContext(taskId, task);

    // Compute only the verdicts still missing. AI calls are the expensive
    // part (no wallet interaction) — safe to run in parallel.
    const computeReviewer = async (): Promise<AgentVerdict | null> =>
      existing.reviewer.hasVoted ? null : reviewerAgent(context);
    const computeFraud = async (): Promise<AgentVerdict | null> =>
      existing.fraud.hasVoted ? null : fraudSanityAgent(context);

    // allSettled, not all: one failed AI call must not discard the other's
    // paid-for output — the good side is submitted, the failed side retries on
    // the next tick/restart (every step below is idempotent).
    const [reviewerSettled, fraudSettled] = await Promise.allSettled([computeReviewer(), computeFraud()]);

    const reviewerVerdict = reviewerSettled.status === "fulfilled" ? reviewerSettled.value : null;
    const fraudVerdict = fraudSettled.status === "fulfilled" ? fraudSettled.value : null;

    if (reviewerSettled.status === "rejected") {
      logger.error("reviewer_agent_failed", { ...logCtx, error: String(reviewerSettled.reason) });
    }
    if (fraudSettled.status === "rejected") {
      logger.error("fraud_sanity_agent_failed", { ...logCtx, error: String(fraudSettled.reason) });
    }

    // Submit fresh verdicts sequentially (each send takes the tx lock).
    if (reviewerVerdict) {
      const res = await submitAgentVerdict(taskId, AgentRole.Reviewer, reviewerVerdict);
      logger.info("agent_verdict_submitted", { ...logCtx, role: "reviewer", approved: reviewerVerdict.approved, submittedOnChain: res.submittedOnChain });
    }
    if (fraudVerdict) {
      const res = await submitAgentVerdict(taskId, AgentRole.FraudSanity, fraudVerdict);
      logger.info("agent_verdict_submitted", { ...logCtx, role: "fraud_sanity", approved: fraudVerdict.approved, submittedOnChain: res.submittedOnChain });
    }

    // Arbiter: only when the two reviewer roles disagree. Re-read the live
    // votes (source of truth — includes anything that landed meanwhile, e.g. a
    // partial retry on another tick) and only then call the Arbiter if needed.
    const live = {
      reviewer: await getVerdict(taskId, AgentRole.Reviewer),
      fraud: await getVerdict(taskId, AgentRole.FraudSanity),
      arbiter: await getVerdict(taskId, AgentRole.Arbiter),
    };
    if (live.reviewer.hasVoted && live.fraud.hasVoted && live.reviewer.approved !== live.fraud.approved && !live.arbiter.hasVoted) {
      // Tie-break. Full reasoning for fresh sides; the pre-existing side's
      // reasoning text is archived off-chain and can be attached by a richer
      // frontend later — the boolean split plus fresh reasoning suffices.
      const arbiterVerdict = await arbiterAgent(context, toAgentVerdict(live.reviewer), toAgentVerdict(live.fraud));
      const res = await submitAgentVerdict(taskId, AgentRole.Arbiter, arbiterVerdict);
      logger.info("agent_verdict_submitted", { ...logCtx, role: "arbiter", approved: arbiterVerdict.approved, submittedOnChain: res.submittedOnChain });
    }

    await tryResolveIfConsensus(taskId);
    logger.info("dispute_processing_complete", logCtx);
  } catch (err) {
    // Never let one task's failure block the poller tick — it is retried on a
    // future tick/restart since every step above is idempotent.
    logger.error("dispute_processing_failed", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function toAgentVerdict(v: VerdictView): AgentVerdict {
  return { approved: v.approved, reasoningText: "(see archived reasoning hash)" };
}

// Once 2-of-3 consensus exists, anyone can call resolveDispute() to lock the
// tentative outcome and open the challenge window. The oracle does it as a
// convenience; a human can always do it too (public function).
async function tryResolveIfConsensus(taskId: bigint): Promise<void> {
  const [reviewer, fraud, arbiter] = await Promise.all([
    getVerdict(taskId, AgentRole.Reviewer),
    getVerdict(taskId, AgentRole.FraudSanity),
    getVerdict(taskId, AgentRole.Arbiter),
  ]);

  let approves = 0;
  let rejects = 0;
  for (const v of [reviewer, fraud, arbiter]) {
    if (!v.hasVoted) continue;
    if (v.approved) approves++;
    else rejects++;
  }
  if (approves < 2 && rejects < 2) return;

  try {
    const { resolveDisputeWithLock } = await import("../verdict/resolve.js");
    await resolveDisputeWithLock(taskId);
    logger.info("dispute_resolved", { taskId: taskId.toString(), tentativeApproved: approves >= 2 });
  } catch (err) {
    logger.warn("dispute_resolve_failed_or_already_resolved", {
      taskId: taskId.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
