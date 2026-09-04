import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { keccak256, toHex } from "viem";
import type { SpecRow } from "@/lib/types";

// Serves (GET) and registers (POST) the spec text for a task
// (taskpay/data/specs), so the UI shows what the agent was asked next to the
// deliverable and the dispute agents can read it.
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

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const id = Number(taskId);
  if (!Number.isInteger(id) || id < 0) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  let body: { spec_text?: string; spec_hash?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const specText = body.spec_text?.trim();
  if (!specText) {
    return NextResponse.json({ error: "spec_text is required" }, { status: 400 });
  }
  const specHash = body.spec_hash ?? keccak256(toHex(specText));
  const name = body.name?.trim() || undefined;

  const row: SpecRow = {
    chain_id: Number(CHAIN_ID),
    task_id: id,
    spec_text: specText,
    spec_hash: specHash,
    ...(name ? { name } : {}),
    created_at: new Date().toISOString(),
  };

  try {
    const dir = path.join(DATA_DIR, "specs", CHAIN_ID);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(row, null, 2), "utf-8");
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "could not persist spec" }, { status: 500 });
  }
}