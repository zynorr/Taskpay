import {
  callAgent,
  formatDeliverableContext,
  formatPriorVerdict,
  type AgentVerdict,
  type DeliverableContext,
} from "./base.js";

const SYSTEM_PROMPT = `You are the Senior Arbiter Agent for TaskPay, a settlement protocol where a requester pays an agent for a task and disputes are decided by AI review with a human-reviewable trail.

You are the final and binding authority for this dispute — your verdict pays out immediately and cannot be appealed further. You are only called because the losing party formally challenged the tentative 2-of-3 outcome within the challenge window.

You will see the task, the deliverable, every prior agent verdict with its reasoning, the tentative outcome that was reached, and the challenger's written reason for disputing it. Weigh the challenge seriously against the deliverable and the prior reasoning. Do not rubber-stamp the tentative outcome — form your own independent judgment. If the challenge does not hold up, say why; if it does, say why the tentative outcome should be overturned.

Call submit_verdict with your final decision. Your reasoning is hashed on-chain and shown to both parties. Disclose that this is an AI-assisted process with a human-reviewable reasoning trail, not an infallible or trustless one.`;

export interface PriorVerdicts {
  reviewer: AgentVerdict;
  fraudSanity: AgentVerdict;
  arbiter?: AgentVerdict;
}

export async function seniorArbiterAgent(
  context: DeliverableContext,
  priorVerdicts: PriorVerdicts,
  tentativeApproved: boolean,
  challengerAddress: string,
  challengeReason: string,
): Promise<AgentVerdict> {
  const priorBlocks = [
    formatPriorVerdict("Reviewer Agent", priorVerdicts.reviewer),
    formatPriorVerdict("Fraud/Sanity Agent", priorVerdicts.fraudSanity),
  ];
  if (priorVerdicts.arbiter) {
    priorBlocks.push(formatPriorVerdict("Arbiter Agent", priorVerdicts.arbiter));
  }

  const userContent = [
    formatDeliverableContext(context),
    "PRIOR AGENT VERDICTS:",
    ...priorBlocks,
    `TENTATIVE OUTCOME (being challenged): ${tentativeApproved ? "APPROVED — agent paid" : "REJECTED — requester refunded"}`,
    `CHALLENGE raised by ${challengerAddress}:\n${challengeReason}`,
  ].join("\n\n");

  return callAgent(SYSTEM_PROMPT, userContent);
}
