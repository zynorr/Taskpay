import { keccak256, toUtf8Bytes } from "ethers";
import { contract, Status } from "../contract/client.js";
import { AgentRole } from "../contract/client.js";
import { getVerdict, getTask } from "../contract/reads.js";
import { insertReasoning, getReasoning, type AgentRoleLabel } from "../store/reasoning.js";
import { env } from "../config/env.js";
import { withTxLock } from "../lib/txMutex.js";
import type { AgentVerdict } from "../agents/base.js";

const AGENT_ROLE_LABELS: Record<number, AgentRoleLabel> = {
  [AgentRole.Reviewer]: "reviewer",
  [AgentRole.FraudSanity]: "fraud_sanity",
  [AgentRole.Arbiter]: "arbiter",
};

const SENIOR_ARBITER_LABEL: AgentRoleLabel = "senior_arbiter";

export function reasoningHashOf(reasoningText: string): string {
  return keccak256(toUtf8Bytes(reasoningText));
}

export interface SubmitResult {
  // False when the verdict was already recorded on-chain and this was a safe,
  // idempotent no-op (no new transaction sent).
  submittedOnChain: boolean;
  txHash?: string;
}

// TaskPay stores the three AI verdicts in a fixed Verdict[3]; there is no
// separate senior-arbiter slot (the source of truth for "has the Senior
// Arbiter voted" is task.status == Challenged AND a pending challenge that
// still has an open window). We archive under a distinct label regardless.
async function ensureArchived(
  taskId: bigint,
  label: AgentRoleLabel,
  verdict: AgentVerdict,
  reasoningHash: string,
): Promise<void> {
  const row = {
    chain_id: env.CHAIN_ID,
    task_id: Number(taskId),
    agent_role: label,
    verdict: verdict.approved,
    reasoning_text: verdict.reasoningText,
    reasoning_hash: reasoningHash,
  };
  const existing = await getReasoning(row.task_id, label, row.chain_id);
  if (existing) return; // insertReasoning performs the mismatch check
  await insertReasoning(row);
}

export async function submitAgentVerdict(taskId: bigint, role: number, verdict: AgentVerdict): Promise<SubmitResult> {
  const label = AGENT_ROLE_LABELS[role];
  if (!label) throw new Error(`Unknown agent role: ${role}`);
  const reasoningHash = reasoningHashOf(verdict.reasoningText);

  const existing = await getVerdict(taskId, role);
  if (existing.hasVoted) {
    if (
      existing.reasoningHash.toLowerCase() !== reasoningHash.toLowerCase() ||
      existing.approved !== verdict.approved
    ) {
      throw new Error(
        `Task ${taskId} role ${label} already has an on-chain verdict (approved=${existing.approved}, hash ${existing.reasoningHash}) ` +
          `that does NOT match what was just computed (approved=${verdict.approved}, hash ${reasoningHash}). ` +
          `Refusing to submit — this indicates non-deterministic re-generation or a real bug, not a safe retry.`,
      );
    }
    await ensureArchived(taskId, label, verdict, reasoningHash);
    return { submittedOnChain: false };
  }

  const { hash: txHash } = await withTxLock(async () => {
    const tx = await contract.submitVerdict(taskId, role, verdict.approved, reasoningHash);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`submitVerdict for task ${taskId} role ${label} failed or reverted (tx: ${tx.hash})`);
    }
    return tx;
  });

  await ensureArchived(taskId, label, verdict, reasoningHash);
  return { submittedOnChain: true, txHash };
}

export async function submitSeniorArbiterVerdict(taskId: bigint, verdict: AgentVerdict): Promise<SubmitResult> {
  const reasoningHash = reasoningHashOf(verdict.reasoningText);

  // The live task status is the source of truth: the Senior Arbiter may only
  // vote while the task is actually Challenged. After any settlement the task
  // leaves Challenged (terminal), and an already-settled task must never be
  // re-voted — the on-chain submitSeniorArbiterVerdict would revert anyway,
  // but we refuse loudly before spending gas.
  const task = await getTask(taskId);
  if (task.status !== Status.Challenged) {
    throw new Error(
      `Task ${taskId} is not in Challenged state (status=${task.status}). Refusing senior arbiter submission.`,
    );
  }
  const existing = await getReasoning(Number(taskId), SENIOR_ARBITER_LABEL, env.CHAIN_ID);
  if (existing && existing.reasoning_hash.toLowerCase() !== reasoningHash.toLowerCase()) {
    throw new Error(
      `Task ${taskId} senior arbiter already ruled with different reasoning. Refusing to submit a second, different verdict.`,
    );
  }

  const { hash: txHash } = await withTxLock(async () => {
    const tx = await contract.submitSeniorArbiterVerdict(taskId, verdict.approved, reasoningHash);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`submitSeniorArbiterVerdict for task ${taskId} failed or reverted (tx: ${tx.hash})`);
    }
    return tx;
  });

  await ensureArchived(taskId, SENIOR_ARBITER_LABEL, verdict, reasoningHash);
  return { submittedOnChain: true, txHash };
}
