import { contract } from "./client.js";
import type { TaskStruct } from "./client.js";

// Read helpers return plain typed objects. These are pure views — they never
// submit anything, so they use the ABI-bound provider contract internally
// (see client.ts) and are safe to parallelize.

export async function getTask(taskId: bigint): Promise<TaskStruct> {
  const raw = await contract.getTask(taskId);
  // ethers returns the struct fields as-is (BigInt for the uint8 status and
  // the timestamp uints). Normalize status to the plain number all downstream
  // comparisons expect (Status.Disputed etc.); keep amount as BigInt.
  return {
    requester: String(raw.requester),
    agent: String(raw.agent),
    amount: BigInt(raw.amount),
    specHash: String(raw.specHash),
    submission: String(raw.submission),
    status: Number(raw.status),
    createdAt: BigInt(raw.createdAt),
    acceptDeadline: BigInt(raw.acceptDeadline),
    workDeadline: BigInt(raw.workDeadline),
    reviewDeadline: BigInt(raw.reviewDeadline),
  } as TaskStruct;
}

export interface VerdictView {
  hasVoted: boolean;
  approved: boolean;
  reasoningHash: string;
}

export async function getVerdict(taskId: bigint, role: number): Promise<VerdictView> {
  const raw = await contract.verdicts(taskId, role);
  return {
    hasVoted: Boolean(raw.hasVoted),
    approved: Boolean(raw.approved),
    reasoningHash: String(raw.reasoningHash),
  };
}

export interface DisputeView {
  tentativeApproved: boolean;
  challengeDeadline: bigint;
  hasChallenged: boolean;
  seniorArbiterDeadline: bigint;
  challengeReasoningHash: string;
}

export async function getDispute(taskId: bigint): Promise<DisputeView> {
  const raw = await contract.disputes(taskId);
  return {
    tentativeApproved: Boolean(raw.tentativeApproved),
    challengeDeadline: raw.challengeDeadline as bigint,
    hasChallenged: Boolean(raw.hasChallenged),
    seniorArbiterDeadline: raw.seniorArbiterDeadline as bigint,
    challengeReasoningHash: String(raw.challengeReasoningHash),
  };
}
