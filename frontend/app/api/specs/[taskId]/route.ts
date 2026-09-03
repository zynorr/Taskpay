import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import type { SpecRow } from "@/lib/types";

// Serves the registered spec text (taskpay/data/specs) for a task so the UI
// can show what the agent was asked to do next to the deliverable.
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

  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "specs", CHAIN_ID, `${id}.json`), "utf-8");
    return NextResponse.json(JSON.parse(raw) as SpecRow);
  } catch {
    return NextResponse.json({ spec_text: null }, { status: 404 });
  }
}