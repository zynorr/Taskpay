import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

// The requester's dispute reason is emitted on-chain (DisputeRaised) but never
// stored — TaskPay deliberately keeps prose off-chain, hashing only what the
// contract needs. This flat-file archive preserves the human-readable reason
// so the frontend can show why a task is (or was) disputed. Writes are
// idempotent and first-write-wins (keyed by chain+task), so a replayed event
// can never clobber the original reason with a later, edited one.

export interface DisputeReasonRow {
  chain_id: number;
  task_id: number;
  requester: string;
  reason: string;
  block_number: number;
  transaction_hash: string;
  created_at: string;
}

function fileFor(chainId: number, taskId: number): string {
  return path.join(env.DATA_DIR, "disputes", String(chainId), `${taskId}.json`);
}

export async function insertDisputeReason(
  row: Omit<DisputeReasonRow, "created_at">,
): Promise<void> {
  const existing = await readDisputeReason(row.task_id, row.chain_id);
  if (existing) return; // first write wins — replay-safe

  await fs.mkdir(path.dirname(fileFor(row.chain_id, row.task_id)), { recursive: true });
  const full: DisputeReasonRow = { ...row, created_at: new Date().toISOString() };
  await fs.writeFile(fileFor(row.chain_id, row.task_id), JSON.stringify(full, null, 2), "utf-8");
}

export async function readDisputeReason(
  taskId: number,
  chainId: number,
): Promise<DisputeReasonRow | undefined> {
  try {
    const raw = await fs.readFile(fileFor(chainId, taskId), "utf-8");
    return JSON.parse(raw) as DisputeReasonRow;
  } catch {
    return undefined; // missing file == no archived reason
  }
}
