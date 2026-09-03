import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import type { ReasoningRow } from "@/lib/types";

// Serves the oracle's file-backed reasoning archive (taskpay/data/reasoning)
// as JSON so the frontend can render the AI verdicts' full reasoning text.
// The archive path is resolved relative to this repo checkout (taskpay/).
const DATA_DIR = process.env.TASKPAY_DATA_DIR ?? path.resolve(process.cwd(), "../data");
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "968";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const id = Number(taskId);
  if (!Number.isInteger(id) || id < 0) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  const dir = path.join(DATA_DIR, "reasoning", CHAIN_ID);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return NextResponse.json({ rows: [] });
  }

  const rows: ReasoningRow[] = [];
  for (const f of files) {
    const match = /^(\d+)\.(\w+)\.json$/.exec(f);
    if (!match) continue;
    if (Number(match[1]) !== id) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf-8");
      rows.push(JSON.parse(raw) as ReasoningRow);
    } catch {
      // skip unreadable rows
    }
  }
  rows.sort((a, b) => a.agent_role.localeCompare(b.agent_role));
  return NextResponse.json({ rows });
}