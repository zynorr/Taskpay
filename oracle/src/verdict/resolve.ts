import { contract } from "../contract/client.js";
import { withTxLock } from "../lib/txMutex.js";

// resolveDispute is a public function on the contract (anyone may call once
// 2-of-3 consensus exists), but the oracle runs it as a convenience on the
// same wallet that submits verdicts — so it must take the same tx lock to
// avoid nonce collisions with a concurrent verdict submission. Reverts are
// harmless (already resolved / no consensus) and are caught by callers.
export async function resolveDisputeWithLock(taskId: bigint): Promise<void> {
  await withTxLock(async () => {
    const tx = await contract.resolveDispute(taskId);
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`resolveDispute for task ${taskId} failed or reverted (tx: ${tx.hash})`);
    }
  });
}
