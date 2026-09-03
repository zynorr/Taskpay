import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

// TaskPay anchors only keccak(reasoningText) on-chain (bytes32), so the
// human-readable reasoning must live somewhere for the frontend to render.
// A flat file store is enough for the oracle-only milestone and keeps the
// archive out of the contract's storage. Writes are idempotent (keyed by
// chain+task+role), so a replayed event cannot duplicate or clobber a matching
// row.

export type AgentRoleLabel = "reviewer" | "fraud_sanity" | "arbiter" | "senior_arbiter";

export interface ReasoningRow {
  chain_id: number;
  task_id: number;
  agent_role: AgentRoleLabel;
  verdict: boolean;
  reasoning_text: string;
  reasoning_hash: string;
  created_at: string;
}

function dirFor(chainId: number): string {
  return path.join(env.DATA_DIR, "reasoning", String(chainId));
}

function fileFor(taskId: number, role: AgentRoleLabel, chainId: number): string {
  return path.join(dirFor(chainId), `${taskId}.${role}.json`);
}

async function readRow(taskId: number, role: AgentRoleLabel, chainId: number): Promise<ReasoningRow | undefined> {
  try {
    const raw = await fs.readFile(fileFor(taskId, role, chainId), "utf-8");
    return JSON.parse(raw) as ReasoningRow;
  } catch {
    return undefined; // missing file == no archived reasoning
  }
}

export async function insertReasoning(row: Omit<ReasoningRow, "created_at">): Promise<void> {
  const existing = await readRow(row.task_id, row.agent_role, row.chain_id);
  if (existing) {
    const sameHash = existing.reasoning_hash.toLowerCase() === row.reasoning_hash.toLowerCase();
    const sameVerdict = existing.verdict === row.verdict;
    if (!sameHash || !sameVerdict) {
      throw new Error(
        `Reasoning already archived for task ${row.task_id} role ${row.agent_role} that does NOT match what was just computed ` +
          `(hash and/or verdict differ). Refusing to overwrite — this indicates non-deterministic re-generation, not a safe retry.`,
      );
    }
    return; // matching row already archived — idempotent no-op
  }

  await fs.mkdir(dirFor(row.chain_id), { recursive: true });
  const full: ReasoningRow = { ...row, created_at: new Date().toISOString() };
  await fs.writeFile(fileFor(row.task_id, row.agent_role, row.chain_id), JSON.stringify(full, null, 2), "utf-8");
}

export async function getReasoning(taskId: number, role: AgentRoleLabel, chainId: number): Promise<ReasoningRow | undefined> {
  return readRow(taskId, role, chainId);
}
