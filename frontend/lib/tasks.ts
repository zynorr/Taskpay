import { getPublicClient, getAccount, signMessage as coreSignMessage } from "@wagmi/core";
import { keccak256, toHex } from "viem";
import { config } from "@/lib/wagmi";
import { CONTRACT_ADDRESS, TASKPAY_ABI } from "@/lib/contract";
import { smartAccountOf, encodeTaskPayCall } from "@/lib/aa";
import { gaslessQuote, gaslessSend } from "@/lib/gasless";
import type { TaskView, VerdictView, DisputeView, AgentRatingRow } from "@/lib/types";

const abi = TASKPAY_ABI;

type WriteName =
  | "createTask"
  | "acceptTask"
  | "submitWork"
  | "release"
  | "rateAgent"
  | "raiseDispute"
  | "challenge"
  | "resolveDispute"
  | "finalizeAfterChallenge"
  | "cancelOpenTask"
  | "reclaimAfterDeadline"
  | "setCancellationApproval";

export async function fetchTaskCount(): Promise<number> {
  const client = getPublicClient(config);
  const count = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "taskCount",
  })) as bigint;
  return Number(count);
}

export async function fetchTask(taskId: bigint): Promise<TaskView> {
  const client = getPublicClient(config);
  const raw = (await client.readContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "getTask",
    args: [taskId],
  })) as unknown as {
    requester: string;
    agent: string;
    amount: bigint;
    specHash: string;
    submission: string;
    status: bigint;
    createdAt: bigint;
    acceptDeadline: bigint;
    workDeadline: bigint;
    reviewDeadline: bigint;
  };
  return {
    taskId,
    requester: raw.requester,
    agent: raw.agent,
    amount: raw.amount,
    specHash: raw.specHash,
    submission: raw.submission,
    status: Number(raw.status),
    createdAt: raw.createdAt,
    acceptDeadline: raw.acceptDeadline,
    workDeadline: raw.workDeadline,
    reviewDeadline: raw.reviewDeadline,
  };
}

// Task ids are dense (0..count-1). Read in small parallel batches so a growing
// marketplace never issues one serial RPC call per task on every poll.
const READ_BATCH = 12;

async function readTasksInRange(fromId: bigint, toIdExclusive: bigint): Promise<TaskView[]> {
  const ids: bigint[] = [];
  for (let i = fromId; i < toIdExclusive; i++) ids.push(i);
  const out: TaskView[] = [];
  for (let s = 0; s < ids.length; s += READ_BATCH) {
    const chunk = ids.slice(s, s + READ_BATCH);
    const rows = await Promise.all(
      chunk.map(async (id) => {
        try {
          return await fetchTask(id);
        } catch {
          return null; // a missing/inconsistent task should not break the list
        }
      }),
    );
    for (const r of rows) if (r) out.push(r);
  }
  return out;
}

export async function fetchAllTasks(limit = 100): Promise<TaskView[]> {
  const count = await fetchTaskCount();
  return readTasksInRange(0n, BigInt(Math.min(count, limit)));
}

/**
 * Newest-first page for the marketplace. Reads the latest `limit` task ids
 * (concurrent batches) and reports the total count so the UI can offer
 * "load more" without guessing.
 */
export async function fetchLatestPage(
  limit: number,
): Promise<{ tasks: TaskView[]; count: number }> {
  const count = await fetchTaskCount();
  if (count === 0) return { tasks: [], count: 0 };
  const n = Math.min(count, limit);
  const fromId = BigInt(Math.max(count - n, 0));
  const rows = await readTasksInRange(fromId, BigInt(count));
  return { tasks: rows.reverse(), count }; // newest first
}

export async function fetchVerdicts(taskId: bigint): Promise<VerdictView[]> {
  const client = getPublicClient(config);
  const out: VerdictView[] = [];
  for (let role = 0; role < 3; role++) {
    const raw = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "verdicts",
      args: [taskId, BigInt(role)],
    })) as { hasVoted: boolean; approved: boolean; reasoningHash: string };
    out.push({
      hasVoted: raw.hasVoted,
      approved: raw.approved,
      reasoningHash: raw.reasoningHash,
    });
  }
  return out;
}

export async function fetchAgentRating(
  agent: string,
): Promise<{ totalScore: bigint; count: bigint } | null> {
  const client = getPublicClient(config);
  try {
    const raw = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "getAgentRatingSummary",
      args: [agent as `0x${string}`],
    })) as [bigint, bigint];
    return { totalScore: raw[0], count: raw[1] };
  } catch {
    return null;
  }
}

// Cap on how many rating rows the profile page reads per agent (the contract
// stores one row per released+rated task; a cap keeps the page bounded).
const MAX_RATING_ROWS = 100;

/** Individual rating records for an agent (oldest first, as stored). */
export async function fetchAgentRatingRows(agent: string): Promise<AgentRatingRow[]> {
  const client = getPublicClient(config);
  const summary = await fetchAgentRating(agent);
  const count = summary ? Math.min(Number(summary.count), MAX_RATING_ROWS) : 0;
  const rows: AgentRatingRow[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const raw = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi,
        functionName: "agentRatings",
        args: [agent as `0x${string}`, BigInt(i)],
      })) as {
        rater: `0x${string}`;
        taskId: bigint;
        score: number; // viem decodes uint8 as number
        ratedAt: bigint;
      };
      rows.push({
        rater: raw.rater,
        taskId: raw.taskId,
        score: raw.score,
        ratedAt: raw.ratedAt,
      });
    } catch {
      /* row read failed — skip */
    }
  }
  return rows;
}

/** Settled (released) task count — TaskPay's core completion signal. */
export async function fetchAgentCompletedCount(agent: string): Promise<number> {
  const client = getPublicClient(config);
  try {
    const raw = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "getAgentTaskCount",
      args: [agent as `0x${string}`],
    })) as bigint;
    return Number(raw);
  } catch {
    return 0;
  }
}

/** All task ids a party appears on (as requester or agent), resolved to rows. */
export async function fetchTaskHistory(party: string): Promise<TaskView[]> {
  const client = getPublicClient(config);
  let ids: bigint[] = [];
  try {
    ids = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "getTasksFor",
      args: [party as `0x${string}`],
    })) as unknown as bigint[];
  } catch {
    return [];
  }
  const out: TaskView[] = [];
  for (let s = 0; s < ids.length; s += READ_BATCH) {
    const chunk = ids.slice(s, s + READ_BATCH);
    const rows = await Promise.all(
      chunk.map(async (id) => {
        try {
          return await fetchTask(id);
        } catch {
          return null;
        }
      }),
    );
    for (const r of rows) if (r) out.push(r);
  }
  return out;
}

export async function fetchDispute(taskId: bigint): Promise<DisputeView | null> {
  const client = getPublicClient(config);
  try {
    const raw = (await client.readContract({
      address: CONTRACT_ADDRESS,
      abi,
      functionName: "disputes",
      args: [taskId],
    })) as {
      tentativeApproved: boolean;
      challengeDeadline: bigint;
      hasChallenged: boolean;
      seniorArbiterDeadline: bigint;
      challengeReasoningHash: string;
    };
    return {
      tentativeApproved: raw.tentativeApproved,
      challengeDeadline: raw.challengeDeadline,
      hasChallenged: raw.hasChallenged,
      seniorArbiterDeadline: raw.seniorArbiterDeadline,
      challengeReasoningHash: raw.challengeReasoningHash,
    };
  } catch {
    return null;
  }
}

export interface CancellationState {
  requester: boolean;
  agent: boolean;
}

// Matches TaskPay's CancellationApproval event (see src/TaskPay.sol). Kept as
// a local literal so viem's getLogs types the args strictly.
const cancellationApprovalEvent = {
  type: "event",
  name: "CancellationApproval",
  inputs: [
    { type: "uint256", name: "taskId", indexed: true },
    { type: "address", name: "party", indexed: true },
    { type: "bool", name: "approved", indexed: false },
  ],
} as const;

/**
 * Whether each party has approved a mutual cancellation (Accepted/Submitted
 * only). The contract stores the flags in private state with no public
 * getter, so derive them from CancellationApproval logs — the latest event
 * per party wins (approval can be withdrawn by approving false).
 */
export async function fetchCancellationApprovals(
  taskId: bigint,
  requester: string,
  agent: string,
): Promise<CancellationState> {
  const client = getPublicClient(config);
  const state: CancellationState = { requester: false, agent: false };
  try {
    const logs = await client.getLogs({
      address: CONTRACT_ADDRESS,
      event: cancellationApprovalEvent,
      args: { taskId },
      fromBlock: 0n,
      toBlock: "latest",
    });
    const req = requester.toLowerCase();
    const agt = agent.toLowerCase();
    for (const log of logs) {
      const party = String(log.args.party ?? "").toLowerCase();
      const approved = Boolean(log.args.approved);
      if (party === req) state.requester = approved;
      else if (party === agt) state.agent = approved;
    }
  } catch {
    /* RPC log filter unavailable — treat as no approvals */
  }
  return state;
}

// specHash for the frontend's create-task flow: keccak256 of the spec text.
export function specHashOf(specText: string): `0x${string}` {
  return keccak256(toHex(specText));
}

export interface TxResult {
  hash: `0x${string}`;
  status: "success" | "reverted" | "dropped" | "unknown";
}

// The EOA's smart account address (its TaskPay identity under gasless mode),
// or the EOA itself when the sponsor stack is not configured.
export async function myIdentity(): Promise<{ eoa: string; smart: string | null }> {
  const account = getAccount(config);
  if (!account.isConnected || !account.address) throw new Error("Wallet not connected");
  const eoa = account.address;
  try {
    const smart = await smartAccountOf(eoa);
    return { eoa, smart };
  } catch {
    // factory unreachable / not configured → fall back to EOA-only identity
    return { eoa, smart: null };
  }
}

/**
 * Gasless write: the connected EOA's smart account performs the call through
 * the oracle's sponsored bundler. The user signs one UserOp hash (no gas, no
 * wallet popup for the tx itself) — the paymaster covers the fee.
 */
export async function writeGasless(
  functionName: WriteName,
  args: readonly unknown[],
  opts: { value?: bigint } = {},
): Promise<TxResult> {
  const account = getAccount(config);
  if (!account.isConnected || !account.address) throw new Error("Wallet not connected");

  const callData = encodeTaskPayCall(functionName, args);
  const quote = await gaslessQuote({
    owner: account.address,
    target: CONTRACT_ADDRESS,
    callData,
    value: opts.value !== undefined ? opts.value.toString() : undefined,
  });

  // SimpleAccount validates ECDSA over toEthSignedMessageHash(userOpHash) — a
  // personal-sign of the raw 32 bytes is exactly that.
  const signature = await coreSignMessage(config, {
    message: { raw: quote.userOpHash as `0x${string}` },
  });

  const sent = await gaslessSend(quote.userOp, signature);
  // handleOps already mined (sendUserOp waits for the receipt); report success.
  return { hash: sent.txHash as `0x${string}`, status: "success" };
}

