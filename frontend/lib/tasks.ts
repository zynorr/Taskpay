import { getPublicClient, getAccount, signMessage as coreSignMessage } from "@wagmi/core";
import { keccak256, toHex } from "viem";
import { config } from "@/lib/wagmi";
import { CONTRACT_ADDRESS, TASKPAY_ABI } from "@/lib/contract";
import { smartAccountOf, encodeTaskPayCall } from "@/lib/aa";
import { gaslessQuote, gaslessSend } from "@/lib/gasless";
import type { TaskView, VerdictView, DisputeView } from "@/lib/types";

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
  | "reclaimAfterDeadline";

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

export async function fetchAllTasks(limit = 100): Promise<TaskView[]> {
  const count = await fetchTaskCount();
  const n = Math.min(count, limit);
  const tasks: TaskView[] = [];
  for (let i = 0; i < n; i++) {
    try {
      tasks.push(await fetchTask(BigInt(i)));
    } catch {
      // a missing/inconsistent task should not break the list
    }
  }
  return tasks;
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

