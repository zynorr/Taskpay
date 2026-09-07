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

const AA_MESSAGES: Record<string, string> = {
  AA10: "The TaskPay account is not deployed correctly. Please reconnect your wallet and try again.",
  AA13: "The account did not have enough gas to validate this action. Please try again.",
  AA14: "The TaskPay account could not be created. Please reconnect your wallet and try again.",
  AA15: "The account factory returned an invalid address. Please contact the TaskPay administrator.",
  AA20: "The TaskPay account rejected this action. Check that you are using the correct wallet.",
  AA21: "The wallet signature was rejected. Please reconnect your wallet and try again.",
  AA22: "The TaskPay account is using an unsupported version. Please contact the TaskPay administrator.",
  AA23: "The TaskPay account failed while executing the action. Check the task status and try again.",
  AA24: "The wallet signature is invalid. Please reconnect the wallet that owns this TaskPay account.",
  AA25: "This action was already submitted or the wallet nonce is out of date. Refresh the page and try again.",
  AA31: "The TaskPay gas sponsor is out of funds. Please try again later while the administrator refills the paymaster.",
  AA40: "The gas sponsor rejected this action because its validity window has expired. Refresh and try again.",
};

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return String(error);
  const value = error as Record<string, unknown>;
  const data = typeof value.data === "string" ? value.data : "";
  let decodedData = "";
  if (/^0x[0-9a-f]+$/i.test(data) && data.length % 2 === 0) {
    try {
      decodedData = new TextDecoder().decode(
        Uint8Array.from(data.slice(2).match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)),
      );
    } catch {
      decodedData = "";
    }
  }
  return [value.message, value.shortMessage, value.reason, value.details, data, decodedData]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

/** Converts provider/ethers errors into messages a user can act on. */
export function friendlyGaslessError(error: unknown): string {
  const raw = errorText(error);
  const upper = raw.toUpperCase();
  const aaCode = upper.match(/\b(AA\d{2})\b/)?.[1];
  if (aaCode && AA_MESSAGES[aaCode]) return AA_MESSAGES[aaCode];
  if (upper.includes("INSUFFICIENT FUNDS")) {
    return "The gas sponsor wallet does not have enough BOT to submit this action. Please try again after it is funded.";
  }
  if (upper.includes("USER REJECTED") || upper.includes("ACTION_REJECTED")) {
    return "The wallet signature was cancelled. No task state was changed.";
  }
  if (upper.includes("RATE LIMIT")) {
    return "Too many sponsored actions were requested. Please wait a minute and try again.";
  }
  if (upper.includes("SPONSOR BUNDLER NOT CONFIGURED") || upper.includes("FAILED TO FETCH")) {
    return "The gas sponsor is temporarily offline. Please try again in a moment.";
  }
  if (upper.includes("CALL_EXCEPTION") || upper.includes("EXECUTION REVERTED")) {
    return "The blockchain rejected this action. Refresh the task and check that the task window is still open.";
  }
  return raw.length > 240 ? "The action failed. Refresh the page and try again." : raw || "The action failed. Please try again.";
}

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
