// Client for the oracle's sponsor bundler (/v1/quote + /v1/send).
//
// Flow (two signatures, in order):
//   1. quote()   — the bundler builds the UserOp, fills gas, and attaches the
//                  VerifyingPaymaster signature. Returns the op + userOpHash.
//   2. The user signs userOpHash with their EOA (SimpleAccount owner) — the
//      browser wallet, via signMessage({ raw }).
//   3. send()    — the bundler simulates then broadcasts handleOps. Gas comes
//      from the paymaster deposit, so the user pays nothing.
import { bundlerUrl, ENTRY_POINT } from "@/lib/aa";

export interface QuoteResult {
  ok: true;
  sender: string;
  isDeployed: boolean;
  userOp: {
    sender: string;
    nonce: string;
    initCode: string;
    callData: string;
    accountGasLimits: string;
    preVerificationGas: string;
    gasFees: string;
    paymasterAndData: string;
    signature: string;
  };
  userOpHash: string;
}

export interface SendResult {
  ok: true;
  txHash: string;
  userOpHash: string;
}

export interface GaslessError {
  ok: false;
  error: string;
}

export type GaslessResponse = QuoteResult | SendResult | GaslessError;

export async function gaslessQuote(input: {
  owner: string;
  target: string;
  callData: string;
  value?: string; // wei as decimal string
  salt?: string;
  validUntil?: number;
}): Promise<QuoteResult> {
  const base = bundlerUrl();
  if (!base) throw new Error("Sponsor bundler not configured (NEXT_PUBLIC_BUNDLER_URL)");
  const res = await fetch(`${base}/v1/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as GaslessResponse;
  if (!body.ok) throw new Error((body as GaslessError).error);
  return body as QuoteResult;
}

export async function gaslessSend(userOp: QuoteResult["userOp"], signature: string): Promise<SendResult> {
  const base = bundlerUrl();
  if (!base) throw new Error("Sponsor bundler not configured (NEXT_PUBLIC_BUNDLER_URL)");
  const res = await fetch(`${base}/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userOp, signature }),
  });
  const body = (await res.json()) as GaslessResponse;
  if (!body.ok) throw new Error((body as GaslessError).error);
  return body as SendResult;
}

export { ENTRY_POINT };
