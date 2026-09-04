import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import type { SpecRow } from "@/lib/types";

// Batch endpoint: returns every registered spec (name + text) keyed by task
// id, so the marketplace can render task titles/descriptions with one request
// instead of N per-card fetches. Tasks without a registered spec are absent
// from the map and the UI falls back to on-chain data.
const DATA_DIR = process.env.TASKPAY_DATA_DIR ?? path.resolve(process.cwd(), "../data");
const CHAIN_ID = process.env.NEXT_PUBLIC_CHAIN_ID ?? "968";

export const dynamic = "force-dynamic";

export async function GET() {
  const dir = path.join(DATA_DIR, "specs", CHAIN_ID);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    files = [];
  }

  const specs: Record<string, Pick<SpecRow, "name" | "spec_text">> = {};
  await Promise.all(
    files
      .filter((f) => /^\d+\.json$/.test(f))
      .map(async (f) => {
        const taskId = f.replace(/\.json$/, "");
        try {
          const raw = await fs.readFile(path.join(dir, f), "utf-8");
          const row = JSON.parse(raw) as SpecRow;
          specs[taskId] = { name: row.name, spec_text: row.spec_text };
        } catch {
          /* skip unreadable spec files */
        }
      }),
  );

  return NextResponse.json({ specs });
}
