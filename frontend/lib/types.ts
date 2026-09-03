export interface TaskView {
  taskId: bigint;
  requester: string;
  agent: string;
  amount: bigint;
  specHash: string;
  submission: string;
  status: number;
  createdAt: bigint;
  acceptDeadline: bigint;
  workDeadline: bigint;
  reviewDeadline: bigint;
}

export interface VerdictView {
  hasVoted: boolean;
  approved: boolean;
  reasoningHash: string;
}

export interface DisputeView {
  tentativeApproved: boolean;
  challengeDeadline: bigint;
  hasChallenged: boolean;
  seniorArbiterDeadline: bigint;
  challengeReasoningHash: string;
}

export interface ReasoningRow {
  chain_id: number;
  task_id: number;
  agent_role: "reviewer" | "fraud_sanity" | "arbiter" | "senior_arbiter";
  verdict: boolean;
  reasoning_text: string;
  reasoning_hash: string;
  created_at: string;
}

export interface SpecRow {
  chain_id: number;
  task_id: number;
  spec_text: string;
  spec_hash: string;
  created_at: string;
}