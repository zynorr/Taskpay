import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddress } from "ethers";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import { buildQuote, sendUserOp, type UserOp } from "./userop.js";
import { SlidingWindowLimiter } from "./rateLimit.js";

/**
 * HTTP surface of the sponsor bundler, mounted under /v1 by index.ts.
 *
 *   POST /v1/quote — body: QuoteInput JSON → QuoteResult (userOp without signature)
 *   POST /v1/send  — body: { userOp, signature } → { txHash }
 *
 * CORS is wide open: the only client is the TaskPay frontend, and the endpoints
 * only relay already-signed ops for a single known contract. Do not add secret
 * data here.
 *
 * Rate limiting: every quote/send is counted per address in a sliding window
 * (default 20 ops/min, tune via ORACLE_BUNDLER_RATE_LIMIT, 0 disables). The
 * sponsor pays gas for every broadcast /v1/send, so an unauthenticated public
 * URL must not be a free-gas faucet.
 */

// One shared limiter for both endpoints, keyed by the acting address. Default
// 20 ops/min comfortably covers the whole task lifecycle for a human while
// stopping scripted drains; env 0 turns it off (private deployments).
const limiter = new SlidingWindowLimiter(env.BUNDLER_RATE_LIMIT ?? 20, 60_000);

export function isBundlerConfigured(): boolean {
  return Boolean(env.AA_FACTORY && env.PAYMASTER);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(payload);
}

function bad(res: ServerResponse, message: string): void {
  sendJson(res, 400, { ok: false, error: message });
}

function tooMany(res: ServerResponse): void {
  sendJson(res, 429, {
    ok: false,
    error: `rate limit exceeded — ${limiterLimit()} ops per address per minute`,
    retryAfterSec: 60,
  });
}

function limiterLimit(): number {
  return env.BUNDLER_RATE_LIMIT ?? 20;
}

export async function handleBundlerRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    res.end();
    return;
  }

  if (req.method !== "POST" || (path !== "/v1/quote" && path !== "/v1/send")) {
    sendJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  if (!isBundlerConfigured()) {
    sendJson(res, 503, {
      ok: false,
      error: "sponsor stack not configured (AA_FACTORY / PAYMASTER env vars missing)",
    });
    return;
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as Record<string, unknown>;

    if (path === "/v1/quote") {
      const owner = String(body.owner ?? "");
      const target = String(body.target ?? "");
      const callData = String(body.callData ?? "");
      if (!isAddress(owner)) return bad(res, "owner must be an address");
      if (!isAddress(target)) return bad(res, "target must be an address");
      if (!/^0x[0-9a-fA-F]*$/.test(callData)) return bad(res, "callData must be 0x-hex");
      if (!limiter.allow(`quote:${owner.toLowerCase()}`)) {
        logger.warn("bundler_rate_limited", { path, owner });
        return tooMany(res);
      }

      const quote = await buildQuote({
        owner,
        target,
        callData,
        value: body.value !== undefined ? BigInt(String(body.value)) : undefined,
        salt: body.salt !== undefined ? BigInt(String(body.salt)) : undefined,
        validUntil: body.validUntil !== undefined ? Number(body.validUntil) : undefined,
      });
      sendJson(res, 200, {
        ok: true,
        ...quote,
        userOp: { ...quote.userOp, nonce: quote.userOp.nonce.toString(), preVerificationGas: quote.userOp.preVerificationGas.toString() },
      });
      logger.info("bundler_quote", { owner, target, sender: quote.sender });
      return;
    }

    // /v1/send
    const userOp = body.userOp as UserOp | undefined;
    const signature = String(body.signature ?? "");
    if (!userOp || typeof userOp !== "object") return bad(res, "userOp is required");
    if (!isAddress(userOp.sender)) return bad(res, "userOp.sender must be an address");
    if (!/^0x[0-9a-fA-F]*$/.test(signature)) return bad(res, "signature must be 0x-hex");
    if (!limiter.allow(`send:${userOp.sender.toLowerCase()}`)) {
      logger.warn("bundler_rate_limited", { path, sender: userOp.sender });
      return tooMany(res);
    }

    userOp.signature = signature;
    userOp.nonce = BigInt(userOp.nonce);
    userOp.preVerificationGas = BigInt(userOp.preVerificationGas);

    const result = await sendUserOp(userOp);
    sendJson(res, 200, { ok: true, ...result });
    logger.info("bundler_sent", { sender: userOp.sender, txHash: result.txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("bundler_request_failed", { path, error: message });
    sendJson(res, 500, { ok: false, error: message });
  }
}
