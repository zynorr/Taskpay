import { NextResponse } from "next/server";

// Same-origin proxy for the sponsor bundler. In the single-container public
// deployment the oracle runs next to Next.js on an internal port, and a web
// service exposes only one HTTP port — so the browser talks to
// /api/bundler/v1/* here and this route forwards to the oracle's /v1/*.
// The frontend switches to this path with NEXT_PUBLIC_BUNDLER_URL=/api/bundler
// (local dev keeps the direct http://localhost:8787 URL and never hits this).
export const dynamic = "force-dynamic";

const ORACLE_INTERNAL = process.env.ORACLE_INTERNAL_URL ?? "http://127.0.0.1:8787";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ route: string }> },
) {
  const { route } = await params;
  if (!/^[a-z]+$/.test(route)) {
    return NextResponse.json({ ok: false, error: "invalid route" }, { status: 400 });
  }
  const body = await req.text();
  try {
    const upstream = await fetch(`${ORACLE_INTERNAL}/v1/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // The oracle is on the same host; a brief hiccup (restart) is worth one
      // quick retry before surfacing 503 to the UI.
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "sponsor bundler unreachable" },
      { status: 503 },
    );
  }
}