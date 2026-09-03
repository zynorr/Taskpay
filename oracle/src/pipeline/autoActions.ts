import { formatEther } from "ethers";
import { contract, oracleWallet, provider, Status } from "../contract/client.js";
import { getTask, getDispute, getVerdict } from "../contract/reads.js";
import { AgentRole } from "../contract/client.js";
import { logger } from "../lib/logger.js";
import { withTxLock } from "../lib/txMutex.js";

// Below this the oracle wallet risks failing to pay gas for its next tx.
// Warning threshold only, not enforced.
const LOW_BALANCE_WARNING_WEI = 10n ** 16n; // 0.01 BOT

async function warnIfLowBalance(): Promise<void> {
  const balance = await provider.getBalance(oracleWallet.address);
  if (balance < LOW_BALANCE_WARNING_WEI) {
    logger.warn("oracle_wallet_balance_low", { address: oracleWallet.address, balanceBot: formatEther(balance) });
  }
}

async function sendAutoTriggeredTx(taskId: bigint, action: string, fn: () => Promise<{ hash: string; wait(): Promise<unknown> }>): Promise<void> {
  await withTxLock(async () => {
    try {
      const tx = await fn();
      const receipt = (await tx.wait()) as { status?: number } | null;
      if (!receipt || receipt.status !== 1) {
        throw new Error(`${action} for task ${taskId} failed or reverted (tx: ${tx.hash})`);
      }
      logger.info("auto_action_sent", { taskId: taskId.toString(), action, txHash: tx.hash });
    } catch (err) {
      // Harmless races (a human already called it) revert on-chain; log at
      // warn not error so a fully settled chain isn't noisy.
      logger.warn("auto_action_failed", {
        taskId: taskId.toString(),
        action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// Judge-first time-based transitions that are PERMISSIONLESS (anyone may call),
// which the oracle auto-triggers as a convenience:
//   - Submitted + reviewDeadline passed  -> finalizeAfterReview   (pays agent)
//   - PendingChallenge + window passed   -> finalizeAfterChallenge (settles)
//   - Challenged + arbiter window passed -> resolveAfterSeniorArbiterTimeout
// The requester-only refund paths (reclaimAfterDeadline / refundExpiredTask /
// refundAfterStalledDispute) are deliberately NOT auto-called: the requester
// has the direct incentive to call them and the contract reserves them for the
// requester anyway. The scan never holds the tx lock across its read phase —
// pure reads run parallel, sends serialize one-by-one.
export async function runAutoActionsScan(): Promise<void> {
  await warnIfLowBalance();

  const taskCount = await contract.taskCount();
  if (taskCount === 0n) return;
  const ids = Array.from({ length: Number(taskCount) }, (_, i) => BigInt(i));
  const tasks = await Promise.all(ids.map((id) => getTask(id)));

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const task = tasks[i]!;

    if (task.status === Status.Submitted && nowSeconds >= task.reviewDeadline) {
      await sendAutoTriggeredTx(id, "finalizeAfterReview", () => contract.finalizeAfterReview(id));
      continue;
    }

    if (task.status === Status.PendingChallenge) {
      const dispute = await getDispute(id);
      if (nowSeconds > dispute.challengeDeadline) {
        await sendAutoTriggeredTx(id, "finalizeAfterChallenge", () => contract.finalizeAfterChallenge(id));
      }
      continue;
    }

    if (task.status === Status.Challenged) {
      const dispute = await getDispute(id);
      if (nowSeconds > dispute.seniorArbiterDeadline) {
        // Only the timeout fallback applies here: if the Senior Arbiter already
        // voted, the task has left Challenged and this branch is unreachable.
        await sendAutoTriggeredTx(id, "resolveAfterSeniorArbiterTimeout", () => contract.resolveAfterSeniorArbiterTimeout(id));
      }
      continue;
    }

    // Disputed past reviewDeadline with no 2-of-3 consensus: requester-only
    // refundAfterStalledDispute. Log once per stalled dispute so operators can
    // nudge the requester, but do not call (only the requester can).
    if (task.status === Status.Disputed && nowSeconds >= task.reviewDeadline) {
      const reviewer = await getVerdict(id, AgentRole.Reviewer);
      const fraud = await getVerdict(id, AgentRole.FraudSanity);
      const arbiter = await getVerdict(id, AgentRole.Arbiter);
      let approves = 0;
      let rejects = 0;
      for (const v of [reviewer, fraud, arbiter]) {
        if (!v.hasVoted) continue;
        if (v.approved) approves++;
        else rejects++;
      }
      if (approves < 2 && rejects < 2) {
        logger.warn("dispute_stalled_requester_action_needed", {
          taskId: id.toString(),
          hint: "review period lapsed without quorum — requester should call refundAfterStalledDispute",
        });
      }
    }
  }
}
