import { getTask, getVerdict, getDispute } from "../contract/reads.js";
import { Status, AgentRole } from "../contract/client.js";
import { buildTaskContext } from "./context.js";
import { seniorArbiterAgent, type PriorVerdicts } from "../agents/index.js";
import { submitSeniorArbiterVerdict } from "../verdict/submit.js";
import { getReasoning } from "../store/reasoning.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import type { ChallengeRaisedEvent } from "../contract/events.js";

// A losing party escalated a tentative 2-of-3 outcome to the human-configurable
// Senior Arbiter. The oracle assembles the full dispute trail (spec, prior
// verdict reasoning, tentative outcome, challenge hash) and submits the
// binding Senior Arbiter verdict, which pays out immediately and cannot be
// appealed.
export async function handleChallengeRaised(event: ChallengeRaisedEvent): Promise<void> {
  const taskId = event.taskId;
  const logCtx = { taskId: taskId.toString() };
  try {
    logger.info("challenge_raised_received", { ...logCtx, challenger: event.challenger, block: event.blockNumber });

    const task = await getTask(taskId);
    if (task.status !== Status.Challenged) {
      logger.info("challenge_skip_wrong_status", { ...logCtx, status: task.status });
      return;
    }

    const dispute = await getDispute(taskId);
    if (!dispute.hasChallenged) {
      logger.warn("challenge_missing_dispute_state", logCtx);
      return;
    }

    const { context } = await buildTaskContext(taskId, task);

    // Prior verdict reasoning comes from the off-chain archive when present
    // (falling back to the on-chain hash only).
    const archivedReasoning = async (roleLabel: "reviewer" | "fraud_sanity" | "arbiter"): Promise<string> => {
      const row = await getReasoning(Number(taskId), roleLabel, env.CHAIN_ID);
      return row?.reasoning_text ?? "(reasoning text not archived; see on-chain hash)";
    };

    const priorVerdicts: PriorVerdicts = {
      reviewer: {
        approved: (await getVerdict(taskId, AgentRole.Reviewer)).approved,
        reasoningText: await archivedReasoning("reviewer"),
      },
      fraudSanity: {
        approved: (await getVerdict(taskId, AgentRole.FraudSanity)).approved,
        reasoningText: await archivedReasoning("fraud_sanity"),
      },
    };
    const arbiterVote = await getVerdict(taskId, AgentRole.Arbiter);
    if (arbiterVote.hasVoted) {
      priorVerdicts.arbiter = {
        approved: arbiterVote.approved,
        reasoningText: await archivedReasoning("arbiter"),
      };
    }

    const challengeText =
      "The challenger submitted an on-chain reasoning hash: " +
      `${event.reasoningHash}. Full challenge text is archived off-chain by the frontend; ` +
      "when it has been registered with the oracle's data store it will be included here.";

    const verdict = await seniorArbiterAgent(context, priorVerdicts, dispute.tentativeApproved, event.challenger, challengeText);
    const res = await submitSeniorArbiterVerdict(taskId, verdict);
    logger.info("senior_arbiter_verdict_submitted", { ...logCtx, approved: verdict.approved, submittedOnChain: res.submittedOnChain });
  } catch (err) {
    logger.error("challenge_processing_failed", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
