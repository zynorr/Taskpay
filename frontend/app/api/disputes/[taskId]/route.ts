import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

// Serves the requester's archived dispute reason for a task
// (taskpay/data/disputes). The oracle archives the reason off-chain when it
// observes DisputeRaised; the contract only anchors the transition on-chain.
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
    const raw = await fs.readFile(path.join(DATA_DIR, "disputes", CHAIN_ID, `${id}.json`), "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ reason: null }, { status: 404 });
  }
}
