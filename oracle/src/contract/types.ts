import type { ContractTransactionResponse, Log } from "ethers";
import type { TaskStruct } from "./client.js";

// Minimal typed surface over the TaskPay contract: only the methods the oracle
// actually calls. `client.ts` casts the ethers Contract to this shape (ethers'
// full generated types for tuple getters are brittle to hand-maintain).
export interface TaskPayAbi {
  // Event log query (used by the poller on the read-only contract instance).
  queryFilter(eventName: string, fromBlock: number, toBlock: number): Promise<Log[]>;
  // Views
  taskCount(): Promise<bigint>;
  getTask(taskId: bigint | number): Promise<TaskStruct>;
  verdicts(taskId: bigint | number, role: number): Promise<{ hasVoted: boolean; approved: boolean; reasoningHash: string }>;
  disputes(taskId: bigint | number): Promise<{
    tentativeApproved: boolean;
    challengeDeadline: bigint;
    hasChallenged: boolean;
    seniorArbiterDeadline: bigint;
    challengeReasoningHash: string;
  }>;

  // Oracle writes (submitted via `contract`, i.e. the oracle wallet)
  submitVerdict(taskId: bigint | number, role: number, approved: boolean, reasoningHash: string): Promise<ContractTransactionResponse>;
  resolveDispute(taskId: bigint | number): Promise<ContractTransactionResponse>;
  submitSeniorArbiterVerdict(taskId: bigint | number, approved: boolean, reasoningHash: string): Promise<ContractTransactionResponse>;

  // Auto-triggered transitions (any caller — we use the oracle wallet)
  finalizeAfterReview(taskId: bigint | number): Promise<ContractTransactionResponse>;
  finalizeAfterChallenge(taskId: bigint | number): Promise<ContractTransactionResponse>;
  resolveAfterSeniorArbiterTimeout(taskId: bigint | number): Promise<ContractTransactionResponse>;
}
