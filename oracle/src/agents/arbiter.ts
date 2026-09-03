import {
  callAgent,
  formatDeliverableContext,
  formatPriorVerdict,
  type AgentVerdict,
  type DeliverableContext,
} from "./base.js";

const SYSTEM_PROMPT = `You are the Arbiter Agent for TaskPay, a settlement protocol where a requester pays an agent for a task and disputes are decided by AI review.

You are only called because the Reviewer Agent and the Fraud/Sanity Agent disagreed, so your vote decides the tentative outcome of the dispute. You will see the task, the deliverable, and both prior agents' verdicts with their full reasoning. Weigh both perspectives independently — read the deliverable yourself rather than deferring to either side. State clearly why you side with one agent's conclusion (or reach a different one) and what justifies it.

Call submit_verdict with your decision. Your reasoning is hashed on-chain and shown to both parties. Do not claim this process is "fully trustless."`;

export async function arbiterAgent(
  context: DeliverableContext,
  reviewerVerdict: AgentVerdict,
  fraudSanityVerdict: AgentVerdict,
): Promise<AgentVerdict> {
  const userContent = [
    formatDeliverableContext(context),
    "PRIOR AGENT VERDICTS (they disagreed, which is why you were called):",
    formatPriorVerdict("Reviewer Agent", reviewerVerdict),
    formatPriorVerdict("Fraud/Sanity Agent", fraudSanityVerdict),
  ].join("\n\n");

  return callAgent(SYSTEM_PROMPT, userContent);
}
