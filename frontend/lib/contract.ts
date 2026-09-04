// Canonical TaskPay deployment on BOT Chain testnet (968).
// Redeployed from the current tested source — see DEPLOY.md.
export const CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_TASKPAY_CONTRACT as `0x${string}` | undefined) ??
  "0x7E159665DF732136dfA3E702d49874095fDf90c5";

export const TASKPAY_ABI = [
  // --- Views ---
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    // NOTE: returns the Task struct — must be declared as a tuple, not flat,
    // or the ABI decoder misreads the tuple offset word.
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "requester", type: "address" },
          { name: "agent", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "specHash", type: "bytes32" },
          { name: "submission", type: "string" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "acceptDeadline", type: "uint256" },
          { name: "workDeadline", type: "uint256" },
          { name: "reviewDeadline", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "verdicts",
    stateMutability: "view",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "role", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "hasVoted", type: "bool" },
          { name: "approved", type: "bool" },
          { name: "reasoningHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "disputes",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tentativeApproved", type: "bool" },
          { name: "challengeDeadline", type: "uint256" },
          { name: "hasChallenged", type: "bool" },
          { name: "seniorArbiterDeadline", type: "uint256" },
          { name: "challengeReasoningHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAgentTaskCount",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "count", type: "uint256" }],
  },
  {
    type: "function",
    name: "getAgentRatingSummary",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "totalScore", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "oracle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "challengeWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "seniorArbiterWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // --- Lifecycle ---
  {
    type: "function",
    name: "createTask",
    stateMutability: "payable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "specHash", type: "bytes32" },
      { name: "acceptWindow", type: "uint256" },
      { name: "workDuration", type: "uint256" },
      { name: "reviewPeriod", type: "uint256" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptTask",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitWork",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "submission", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "rateAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "score", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelOpenTask",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reclaimAfterDeadline",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },

  // --- Dispute ---
  {
    type: "function",
    name: "raiseDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "challenge",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "reasoningHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveDispute",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "finalizeAfterChallenge",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },

  // --- Events ---
  {
    type: "event",
    name: "TaskCreated",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "specHash", type: "bytes32", indexed: false },
      { name: "acceptWindow", type: "uint256", indexed: false },
      { name: "workDuration", type: "uint256", indexed: false },
      { name: "reviewPeriod", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskAccepted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "workDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskSubmitted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "submission", type: "string", indexed: false },
      { name: "reviewDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskReleased",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TaskRefunded",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DisputeRaised",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VerdictSubmitted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "role", type: "uint8", indexed: true },
      { name: "approved", type: "bool", indexed: false },
      { name: "reasoningHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TentativeResolution",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "approved", type: "bool", indexed: false },
      { name: "challengeDeadline", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ChallengeRaised",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "challenger", type: "address", indexed: true },
      { name: "reasoningHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SeniorArbiterVerdict",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "approved", type: "bool", indexed: false },
      { name: "reasoningHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

// TaskPay.Status enum (see src/TaskPay.sol)
export const Status = {
  Created: 0,
  Accepted: 1,
  Submitted: 2,
  Disputed: 3,
  PendingChallenge: 4,
  Challenged: 5,
  Released: 6,
  Refunded: 7,
  Cancelled: 8,
} as const;

export const STATUS_LABELS: Record<number, string> = {
  [Status.Created]: "Created",
  [Status.Accepted]: "Accepted",
  [Status.Submitted]: "Submitted",
  [Status.Disputed]: "Disputed",
  [Status.PendingChallenge]: "Pending challenge",
  [Status.Challenged]: "Challenged (Senior Arbiter)",
  [Status.Released]: "Released",
  [Status.Refunded]: "Refunded",
  [Status.Cancelled]: "Cancelled",
};

// TaskPay.AgentRole (see src/TaskPay.sol)
export const AgentRole = {
  Reviewer: 0,
  FraudSanity: 1,
  Arbiter: 2,
} as const;

export const ROLE_LABELS: Record<number, string> = {
  [AgentRole.Reviewer]: "Reviewer",
  [AgentRole.FraudSanity]: "Fraud/Sanity",
  [AgentRole.Arbiter]: "Arbiter",
};