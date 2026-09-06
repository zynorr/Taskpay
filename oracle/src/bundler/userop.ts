import { concat, toBeHex, zeroPadValue, getBytes, Interface } from "ethers";
import { env } from "../config/env.js";
import { provider, oracleWallet } from "../contract/client.js";
import { withTxLock } from "../lib/txMutex.js";
import entryPointAbi from "./abi/EntryPoint.json" with { type: "json" };
import factoryAbi from "./abi/SimpleAccountFactory.json" with { type: "json" };
import paymasterAbi from "./abi/VerifyingPaymaster.json" with { type: "json" };
import simpleAccountAbi from "./abi/SimpleAccount.json" with { type: "json" };

/**
 * ERC-4337 v0.7 sponsor bundler for TaskPay.
 *
 * The oracle runs the only bundler on BOT Chain testnet for TaskPay. It exposes
 * two endpoints to the frontend:
 *
 *   1. POST /v1/quote — build a UserOperation that makes the caller's
 *      SimpleAccount invoke a TaskPay method. Fills nonce/gas fields, attaches
 *      paymasterAndData signed by the VerifyingPaymaster signer (the oracle
 *      key), and returns the userOpHash the account owner signs with their EOA.
 *   2. POST /v1/send  — take the completed UserOperation (owner signature
 *      attached), simulate it with eth_call, then broadcast handleOps from the
 *      oracle EOA (the bundler). Gas is paid from the paymaster's EntryPoint
 *      deposit and refunded to the bundler, so the end user pays nothing.
 *
 * Signing order mirrors the canonical VerifyingPaymaster flow: the paymaster
 * signature is created first (its getHash excludes paymasterAndData itself),
 * appended into paymasterAndData, and only then is the final userOpHash
 * computed and handed to the owner to sign.
 *
 * All reads go through explicit eth_call encodes rather than ethers Contract
 * proxies, so an ABI function name colliding with an ethers built-in (e.g.
 * getAddress) can never route to the wrong implementation.
 */

const entryPointIface = new Interface(entryPointAbi);
const factoryIface = new Interface(factoryAbi);
const paymasterIface = new Interface(paymasterAbi);
const accountIface = new Interface(simpleAccountAbi);

/** Canonical v0.7 EntryPoint, live on BOT Chain (byte-identical to mainnet). */
export const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** Seconds per block on BOT Chain (~0.75s blocks). */
const FALLBACK_GAS_PRICE = 20_000_000_000n; // 20 gwei, BOT's fixed price

export interface UserOp {
  sender: string;
  nonce: bigint;
  initCode: string;
  callData: string;
  accountGasLimits: string; // bytes32: verificationGasLimit (hi128) | callGasLimit (lo128)
  preVerificationGas: bigint;
  gasFees: string; // bytes32: maxPriorityFeePerGas (hi128) | maxFeePerGas (lo128)
  paymasterAndData: string;
  signature: string;
}

export interface QuoteInput {
  owner: string; // EOA that owns the SimpleAccount
  target: string; // contract the account calls (TaskPay)
  callData: string; // ABI-encoded method call on `target`
  value?: bigint; // wei sent alongside the call (escrow for createTask)
  salt?: bigint; // CREATE2 salt; the canonical account uses 0
  validUntil?: number; // unix seconds; default now + 10 min
}

export interface QuoteResult {
  sender: string; // the SimpleAccount — its address is the user's TaskPay identity
  isDeployed: boolean;
  userOp: UserOp; // complete except `signature` (the owner fills it)
  userOpHash: string; // what the owner signs with their EOA
}

/** Pack two uint128s into a bytes32: hi128 = first, lo128 = second. */
function packUints(hi: bigint, lo: bigint): string {
  return concat([toBeHex(hi, 16), toBeHex(lo, 16)]);
}

/** abi.encode(uint48, uint48) — two 32-byte words, as VerifyingPaymaster decodes. */
function encodeTimestamps(validUntil: bigint, validAfter: bigint): string {
  return concat([zeroPadValue(toBeHex(validUntil, 6), 32), zeroPadValue(toBeHex(validAfter, 6), 32)]);
}

/** SimpleAccount.execute(dest, value, func) — the calldata every TaskPay op carries. */
function accountExecuteCall(target: string, value: bigint, func: string): string {
  return accountIface.encodeFunctionData("execute", [target, value, func]);
}

/** ABI-encode a PackedUserOperation tuple for an eth_call / tx input. */
function encodeUserOp(op: UserOp): Record<string, unknown> {
  return {
    sender: op.sender,
    nonce: op.nonce,
    initCode: op.initCode,
    callData: op.callData,
    accountGasLimits: op.accountGasLimits,
    preVerificationGas: op.preVerificationGas,
    gasFees: op.gasFees,
    paymasterAndData: op.paymasterAndData,
    signature: op.signature,
  };
}

async function ethCall(to: string, data: string): Promise<string> {
  const res = await provider.call({ to, data });
  if (res === "0x" || !res) throw new Error(`empty eth_call result for ${to}`);
  return res;
}

/** View reads via explicit encoding (immune to ethers Contract name collisions). */
async function factoryGetAddress(owner: string, salt: bigint): Promise<string> {
  const data = factoryIface.encodeFunctionData("getAddress", [owner, salt]);
  const res = await ethCall(env.AA_FACTORY!, data);
  return factoryIface.decodeFunctionResult("getAddress", res)[0] as string;
}

async function entryPointGetNonce(sender: string): Promise<bigint> {
  // v0.7 EntryPoint: getNonce(address sender, uint192 key). Key 0 is the
  // default sequential nonce that SimpleAccounts use.
  const data = entryPointIface.encodeFunctionData("getNonce", [sender, 0n]);
  const res = await ethCall(ENTRY_POINT, data);
  return entryPointIface.decodeFunctionResult("getNonce", res)[0] as bigint;
}

async function entryPointGetUserOpHash(op: UserOp): Promise<string> {
  const data = entryPointIface.encodeFunctionData("getUserOpHash", [encodeUserOp(op)]);
  const res = await ethCall(ENTRY_POINT, data);
  return entryPointIface.decodeFunctionResult("getUserOpHash", res)[0] as string;
}

async function paymasterGetHash(op: UserOp, validUntil: bigint, validAfter: bigint): Promise<string> {
  const data = paymasterIface.encodeFunctionData("getHash", [
    encodeUserOp(op),
    validUntil,
    validAfter,
  ]);
  const res = await ethCall(env.PAYMASTER!, data);
  return paymasterIface.decodeFunctionResult("getHash", res)[0] as string;
}

async function chainGasPrice(): Promise<bigint> {
  const fee = await provider.getFeeData();
  return fee.gasPrice ?? FALLBACK_GAS_PRICE;
}

/**
 * Quote step: build the UserOp minus the owner signature and return the hash to
 * sign. The paymaster (VerifyingPaymaster) signature is produced here, before the
 * account signature — its getHash covers the op fields but not paymasterAndData,
 * so appending its signature afterwards does not invalidate it. The userOpHash
 * returned DOES cover the signed paymasterAndData, so the owner signs last.
 */
export async function buildQuote(input: QuoteInput): Promise<QuoteResult> {
  if (!env.AA_FACTORY || !env.PAYMASTER) {
    throw new Error("AA_FACTORY/PAYMASTER not configured — cannot sponsor gasless ops");
  }
  const owner = input.owner.toLowerCase();
  const salt = input.salt ?? 0n;
  const validUntil = BigInt(input.validUntil ?? Math.floor(Date.now() / 1000) + 600);
  const validAfter = 0n;

  // Counterfactual account address, and whether it already exists on-chain.
  const sender = await factoryGetAddress(owner, salt);
  const isDeployed = (await provider.getCode(sender)) !== "0x";

  // initCode (factory ++ createAccount) is only needed until the account exists.
  let initCode = "0x";
  if (!isDeployed) {
    initCode = concat([
      env.AA_FACTORY,
      factoryIface.encodeFunctionData("createAccount", [owner, salt]),
    ]);
  }

  const gasPrice = await chainGasPrice();
  const verificationGasLimit = 300_000n;
  // Room for on-chain text storage: submitWork stores the full submission
  // string in the Task struct (~22k gas per 32-byte word), so a ~2KB
  // deliverable needs ~1.4M+ gas. 250k silently OOG'd such ops (v0.7
  // swallows execution failures — tx mines with status 1 and success=false).
  // Over-collateralizing the prefund costs nothing: the EntryPoint charges
  // actual gas and refunds the rest to the paymaster.
  const callGasLimit = 2_000_000n;
  const preVerificationGas = 50_000n; // covers calldata + fixed overhead

  // v0.7 EntryPoint sequences nonces per-sender via its NonceManager.
  const nonce = await entryPointGetNonce(sender);

  const callData = accountExecuteCall(input.target, input.value ?? 0n, input.callData);

  // paymasterAndData = paymaster(20) ++ verificationGasLimit(16) ++ postOpGasLimit(16)
  //                   ++ validUntil(32) ++ validAfter(32) ++ signature (appended after).
  const postOpGasLimit = 50_000n;
  const paymasterStatic = concat([
    env.PAYMASTER,
    toBeHex(verificationGasLimit, 16),
    toBeHex(postOpGasLimit, 16),
    encodeTimestamps(validUntil, validAfter),
  ]);

  const userOp: UserOp = {
    sender,
    nonce,
    initCode,
    callData,
    accountGasLimits: packUints(verificationGasLimit, callGasLimit),
    preVerificationGas,
    gasFees: packUints(gasPrice, gasPrice), // equal fees = legacy mode (base fee is 0 on BOT)
    paymasterAndData: paymasterStatic,
    signature: "0x",
  };

  // Paymaster signature over getHash(userOp, validUntil, validAfter), signed with
  // the oracle key (= the paymaster's verifyingSigner). signMessage applies the
  // "\x19Ethereum Signed Message" prefix, matching the contract's
  // ECDSA.recover(toEthSignedMessageHash(getHash())) check exactly.
  const paymasterHash = await paymasterGetHash(userOp, validUntil, validAfter);
  const paymasterSig = await oracleWallet.signMessage(getBytes(paymasterHash));

  userOp.paymasterAndData = concat([paymasterStatic, paymasterSig]);

  // Final hash over the complete op (paymaster sig included) — the owner signs this.
  const userOpHash = await entryPointGetUserOpHash(userOp);
  return { sender, isDeployed, userOp, userOpHash };
}

/** Encode EntryPoint.handleOps([op], beneficiary). */
function encodeHandleOps(ops: UserOp[], beneficiary: string): string {
  return entryPointIface.encodeFunctionData("handleOps", [ops.map(encodeUserOp), beneficiary]);
}

// v0.7 EntryPoint events (canonical ABI). UserOperationEvent carries the
// per-op success flag: execution-phase failures are CAUGHT by handleOps (the
// tx still mines with status 1), so the receipt status alone cannot tell a
// successful op from a silently reverted one.
const ENTRY_POINT_EVENTS = [
  "event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)",
] as const;

/** Parse the simulated/broadcast op's UserOperationEvent success flag. */
function findUserOpSuccess(logs: readonly { topics: readonly string[]; data: string }[], sender: string): boolean | null {
  const iface = new Interface(ENTRY_POINT_EVENTS);
  for (const log of logs) {
    let parsed;
    try {
      parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
    } catch {
      continue; // not a UserOperationEvent
    }
    if (parsed && String(parsed.args.sender).toLowerCase() === sender.toLowerCase()) {
      return Boolean(parsed.args.success);
    }
  }
  return null; // no matching event found
}

/** True if the op FAILED during execution even though the tx mined (status 1). */
async function assertUserOpSucceeded(txHash: string, userOp: UserOp): Promise<void> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`no receipt for handleOps tx ${txHash}`);
  const success = findUserOpSuccess(receipt.logs, userOp.sender);
  if (success === false) {
    // Actual gas was spent and cannot be recovered; fail loud so callers
    // (bot, frontend) know the task did NOT transition and can retry.
    throw new Error(`UserOperation failed during execution (tx ${txHash} mined but the op's inner call reverted or ran out of gas)`);
  }
}

/**
 * Send step: simulate with eth_call (no gas spent on failure), then broadcast
 * handleOps from the bundler (oracle) EOA. The paymaster deposit in the
 * EntryPoint covers the op's gas; the bundler EOA only fronts the tx fee and is
 * refunded by the EntryPoint on settlement.
 */
export async function sendUserOp(userOp: UserOp): Promise<{ txHash: string; userOpHash: string }> {
  if (!env.AA_FACTORY || !env.PAYMASTER) {
    throw new Error("AA_FACTORY/PAYMASTER not configured — cannot sponsor gasless ops");
  }
  const userOpHash = await entryPointGetUserOpHash(userOp);

  // Simulate the full lifecycle (account sig, paymaster sig, execution, funding)
  // before spending any gas.
  await provider.call({
    to: ENTRY_POINT,
    data: encodeHandleOps([userOp], oracleWallet.address),
    gasLimit: 5_000_000n,
  });

  const data = encodeHandleOps([userOp], oracleWallet.address);
  const est = await provider.estimateGas({ to: ENTRY_POINT, data });
  const gasPrice = await chainGasPrice();

  // Legacy tx (type 0): BOT Chain has baseFeePerGas = 0 and a fixed gas price.
  // The broadcast MUST hold the shared oracle-wallet tx lock: the event poller
  // and the deadline scanner also send from oracleWallet, and two interleaved
  // sendTransaction calls would grab the same nonce and replace each other
  // (ethers does not serialize sends per wallet). The lock keeps exactly one
  // send + wait in flight at a time.
  const { txHash } = await withTxLock(async () => {
    const tx = await oracleWallet.sendTransaction({
      to: ENTRY_POINT,
      data,
      gasLimit: (est * 130n) / 100n,
      gasPrice,
      type: 0,
    });
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`handleOps tx reverted: ${tx.hash}`);
    }
    return { txHash: tx.hash };
  });
  // The tx can mine with status 1 while the op itself failed during execution
  // (v0.7 catches per-op failures). Check the UserOperationEvent success flag
  // so a silently-failed op is reported instead of mistaken for a success.
  await assertUserOpSucceeded(txHash, userOp);
  return { txHash, userOpHash };
}
