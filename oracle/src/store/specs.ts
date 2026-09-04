import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";

// TaskPay stores only keccak(specText) on-chain. For the AI agents to judge a
// dispute against the actual spec, the requester's full spec text must exist
// somewhere off-chain. Registration happens out-of-band (frontend/API in phase
// 3); for the oracle milestone, spec text can be dropped here by a small
// script or the frontend's create-task flow. The oracle looks text up by
// (chain, taskId) at dispute time and passes whatever it finds to the agents.

export interface SpecRow {
  chain_id: number;
  task_id: number;
  spec_text: string;
  spec_hash: string; // keccak of spec_text — cross-check against on-chain specHash
  name?: string; // human-readable task name, shown in the marketplace UI
  created_at: string;
}

function dirFor(chainId: number): string {
  return path.join(env.DATA_DIR, "specs", String(chainId));
}

function fileFor(taskId: number, chainId: number): string {
  return path.join(dirFor(chainId), `${taskId}.json`);
}

export async function registerSpec(taskId: number, specText: string, specHash: string, chainId: number): Promise<void> {
  await fs.mkdir(dirFor(chainId), { recursive: true });
  const full: SpecRow = {
    chain_id: chainId,
    task_id: taskId,
    spec_text: specText,
    spec_hash: specHash,
    created_at: new Date().toISOString(),
  };
  await fs.writeFile(fileFor(taskId, chainId), JSON.stringify(full, null, 2), "utf-8");
}

export async function getSpecText(taskId: number, chainId: number): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(fileFor(taskId, chainId), "utf-8");
    const row = JSON.parse(raw) as SpecRow;
    return row.spec_text || undefined;
  } catch {
    return undefined;
  }
}
