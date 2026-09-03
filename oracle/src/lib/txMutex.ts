import { logger } from "./logger.js";

// The oracle wallet sends transactions from several concurrent drivers:
//   - the event poller tick (submitVerdict, resolveDispute, ...)
//   - the auto-actions scan (finalizeAfterReview / ...)
// A single nonce manager would collide if two sends interleave. Serialize
// every oracle-wallet send behind one promise chain; each fn() must perform
// exactly one send (or a send + wait) so the lock releases at most one nonce
// per turn. Pure reads never take the lock.

let tail: Promise<unknown> = Promise.resolve();

export async function withTxLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn());
  // Keep the chain alive even if this call fails — a rejected link must not
  // break the lock for everyone after it.
  tail = result.catch((err: unknown) => {
    logger.error("tx_lock_chain_error", { error: err instanceof Error ? err.message : String(err) });
  });
  return result;
}
