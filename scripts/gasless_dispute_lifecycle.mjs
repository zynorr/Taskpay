// Live driver: full gasless DISPUTE lifecycle through the exact HTTP surface
// the Next.js UI uses (POST /v1/quote → owner signs userOpHash → POST /v1/send).
// Fresh EOAs act through their SimpleAccounts: createTask → acceptTask →
// submitWork → raiseDispute → (oracle Groq agents rule) → resolveDispute →
// challenge from the losing party → (oracle Senior Arbiter rules) → settlement.
// Every TaskPay action is sponsored (0 gas for both users).
//
// Usage: node scripts/gasless_dispute_lifecycle.mjs
// Requires: oracle bundler running (PORT=8787), frontend running (:3000) if
// you want the UI verification section.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ethersPath = pathToFileURL(resolve(__dirname, "../oracle/node_modules/ethers/lib.esm/index.js")).href;
const { Wallet, Interface, JsonRpcProvider, getBytes, keccak256, toUtf8Bytes, parseEther, formatEther } =
  await import(ethersPath);
const dotenv = await import(pathToFileURL(resolve(__dirname, "../oracle/node_modules/dotenv/lib/main.js")).href);
dotenv.config({ path: resolve(__dirname, "../.env") });

const BUNDLER = process.env.BUNDLER_URL ?? "http://localhost:8787";
const FRONTEND = "http://localhost:3000";
const provider = new JsonRpcProvider(process.env.RPC_URL, Number(process.env.CHAIN_ID), { staticNetwork: true });
const deployer = new Wallet(process.env.PRIVATE_KEY, provider);
const CONTRACT = process.env.CONTRACT_ADDRESS;
const DATA_DIR = resolve(__dirname, "../data");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 968);

const factoryIface = new Interface(
  JSON.parse(readFileSync(resolve(__dirname, "../out/SimpleAccountFactory.sol/SimpleAccountFactory.json"), "utf8")).abi,
);
const taskPayIface = new Interface(JSON.parse(readFileSync(resolve(__dirname, "../out/TaskPay.sol/TaskPay.json"), "utf8")).abi);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function read(name, args) {
  const data = taskPayIface.encodeFunctionData(name, args ?? []);
  const res = await provider.call({ to: CONTRACT, data });
  const dec = taskPayIface.decodeFunctionResult(name, res);
  return dec.length === 1 ? dec[0] : dec;
}
async function factoryGetAddress(owner) {
  const data = factoryIface.encodeFunctionData("getAddress", [owner, 0n]);
  const res = await provider.call({ to: process.env.AA_FACTORY, data });
  return factoryIface.decodeFunctionResult("getAddress", res)[0];
}

// ---- gasless step: exactly what frontend/lib/gasless.ts does ----------------
async function gasless(owner, callData, value, label) {
  const quoteRes = await fetch(`${BUNDLER}/v1/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: owner.address, target: CONTRACT, callData, value: value.toString() }),
  });
  const quote = await quoteRes.json();
  if (!quote.ok) throw new Error(`quote failed for ${label}: ${quote.error}`);
  const signature = await owner.signMessage(getBytes(quote.userOpHash));
  const sendRes = await fetch(`${BUNDLER}/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userOp: quote.userOp, signature }),
  });
  const sent = await sendRes.json();
  if (!sent.ok) throw new Error(`send failed for ${label}: ${sent.error}`);
  console.log(`  [${label}] tx ${sent.txHash.slice(0, 18)}…  (account ${quote.isDeployed ? "already deployed" : "deployed by this op"})`);
  return { txHash: sent.txHash, sender: quote.sender };
}

async function waitFor(label, fn, timeoutMs = 180_000, intervalMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// ---------------------------------------------------------------------------
// 1. Fresh users: requester EOA + agent EOA (their smart accounts become the
//    on-chain identities; all actions below are sponsored).
// ---------------------------------------------------------------------------
const requester = Wallet.createRandom().connect(provider);
const agent = Wallet.createRandom().connect(provider);
console.log("requester owner:", requester.address);
console.log("agent owner:    ", agent.address);

// EOA funds (only used to seed the escrow pre-fund; no TaskPay action costs gas).
for (const w of [requester, agent]) {
  await (await deployer.sendTransaction({ to: w.address, value: parseEther("0.02") })).wait();
}

const requesterSmart = await factoryGetAddress(requester.address);
const agentSmart = await factoryGetAddress(agent.address);
console.log("requester smart:", requesterSmart, `(${((await provider.getCode(requesterSmart)) === "0x" ? "not deployed yet" : "deployed")})`);
console.log("agent smart:    ", agentSmart);

const escrow = parseEther("0.01");
await (await deployer.sendTransaction({ to: requesterSmart, value: escrow })).wait();
console.log("pre-funded requester smart account with escrow:", formatEther(escrow), "tBOT");

// ---------------------------------------------------------------------------
// 2. Spec + on-chain anchor. specHash = keccak(specText) so the archive row
//    cross-checks against the on-chain anchor exactly like the frontend does.
// ---------------------------------------------------------------------------
const taskId = Number(BigInt(await read("taskCount", [])));
const specText =
  "Write a Python script (fib.py) that prints the first N Fibonacci numbers, " +
  "where N is read from argv. The script must run without errors on Python 3 and " +
  "include a small unit test (test_fib.py) asserting fib(10) == [0,1,1,2,3,5,8,13,21,34].";
const specHash = keccak256(toUtf8Bytes(specText));

const specFile = resolve(DATA_DIR, "specs", String(CHAIN_ID), `${taskId}.json`);
mkdirSync(resolve(DATA_DIR, "specs", String(CHAIN_ID)), { recursive: true });
writeFileSync(
  specFile,
  JSON.stringify(
    {
      chain_id: CHAIN_ID,
      task_id: taskId,
      spec_text: specText,
      spec_hash: specHash,
      created_at: new Date().toISOString(),
    },
    null,
    2,
  ),
  "utf-8",
);
console.log(`\nspec registered → data/specs/${CHAIN_ID}/${taskId}.json (task #${taskId})`);

// ---------------------------------------------------------------------------
// 3. createTask (gasless, requester) — windows: accept/work/review 600s each
// ---------------------------------------------------------------------------
console.log(`\n[1] createTask — task #${taskId} (escrow ${formatEther(escrow)} tBOT, windows 600/600/600)`);
await gasless(
  requester,
  taskPayIface.encodeFunctionData("createTask", [agentSmart, specHash, 600n, 600n, 600n]),
  escrow,
  "createTask",
);

// ---------------------------------------------------------------------------
// 4. acceptTask + submitWork (gasless, agent) — deliverable is deliberately
//    deficient so the AI quorum has clear evidence to judge.
// ---------------------------------------------------------------------------
console.log("\n[2] acceptTask");
await gasless(agent, taskPayIface.encodeFunctionData("acceptTask", [BigInt(taskId)]), 0n, "acceptTask");

console.log("\n[3] submitWork — deficient deliverable (no repo pin, no code)");
const submission =
  "The work is complete. Please review and release the funds. " +
  "(No repository link or code was attached — see spec for what was required.)";
await gasless(agent, taskPayIface.encodeFunctionData("submitWork", [BigInt(taskId), submission]), 0n, "submitWork");

// ---------------------------------------------------------------------------
// 5. raiseDispute (gasless, requester) — gates the AI pipeline
// ---------------------------------------------------------------------------
console.log("\n[4] raiseDispute — requester disputes the deliverable");
await gasless(
  requester,
  taskPayIface.encodeFunctionData("raiseDispute", [BigInt(taskId), "Deliverable does not satisfy the spec: no code was submitted."]),
  0n,
  "raiseDispute",
);

// ---------------------------------------------------------------------------
// 6. Wait for the oracle: poller picks up DisputeRaised → Groq agents
//    (reviewer + fraud_sanity) rule → verdicts archived → resolveDispute
// ---------------------------------------------------------------------------
console.log(`\n[5] waiting for oracle Groq agents to rule (poller every 10s + AI latency)…`);
const reasoningDir = resolve(DATA_DIR, "reasoning", String(CHAIN_ID));
const reasoningFile = (role) => resolve(reasoningDir, `${taskId}.${role}.json`);
await waitFor(
  "reviewer verdict archived",
  () => existsSync(reasoningFile("reviewer")) && existsSync(reasoningFile("fraud_sanity")),
);
const statusAfterQuorum = await waitFor("status == PendingChallenge", async () => {
  const t = await read("getTask", [BigInt(taskId)]);
  return t.status === 4n ? t : null;
});
console.log("  verdicts archived + on-chain status → PendingChallenge (tentative outcome locked)");

// ---------------------------------------------------------------------------
// 7. Challenge from the losing party (gasless) → Senior Arbiter rules
// ---------------------------------------------------------------------------
const tentativeApproved = await waitFor("tentative outcome readable", async () => {
  const d = await read("disputes", [BigInt(taskId)]);
  return typeof d.tentativeApproved === "boolean" ? d : null;
});
const losingParty = tentativeApproved.tentativeApproved ? requester : agent;
const challengerRole = tentativeApproved.tentativeApproved ? "requester" : "agent";
console.log(
  `\n[6] tentative outcome: ${tentativeApproved.tentativeApproved ? "APPROVED (agent paid)" : "REJECTED (requester refunded)"} — ` +
    `${challengerRole} (losing party) challenges`,
);
const challengeReason =
  "I completed the task exactly as specified. The quorum ignored my deliverable; " +
  "I demand a human-grade review of my work before any refund.";
const challengeHash = keccak256(toUtf8Bytes(challengeReason));
await gasless(losingParty, taskPayIface.encodeFunctionData("challenge", [BigInt(taskId), challengeHash]), 0n, "challenge");

console.log("\n[7] waiting for oracle Senior Arbiter (Groq) to rule on the appeal…");
await waitFor("senior arbiter verdict archived", () => existsSync(reasoningFile("senior_arbiter")));
const terminal = await waitFor("terminal settlement (Released|Refunded)", async () => {
  const t = await read("getTask", [BigInt(taskId)]);
  return t.status === 6n || t.status === 7n ? t : null;
});
const STATUS = ["Created", "Accepted", "Submitted", "Disputed", "PendingChallenge", "Challenged", "Released", "Refunded", "Cancelled"];
console.log(`  senior arbiter ruled — task settled: ${STATUS[Number(terminal.status)]}`);

// ---------------------------------------------------------------------------
// 8. Show the archived AI verdicts (what the UI renders)
// ---------------------------------------------------------------------------
console.log("\n=== archived AI reasoning (data/reasoning/" + CHAIN_ID + "/" + taskId + ".*) ===");
for (const role of ["reviewer", "fraud_sanity", "senior_arbiter"]) {
  const file = reasoningFile(role);
  if (!existsSync(file)) continue;
  const row = JSON.parse(readFileSync(file, "utf8"));
  console.log(`\n--- ${role} — ${row.verdict ? "APPROVE" : "REJECT"} ---`);
  console.log((row.reasoning_text ?? "").slice(0, 600));
}

// ---------------------------------------------------------------------------
// 9. UI verification: the frontend's API routes must serve the fresh dispute
//    trail, exactly what the task detail page renders.
// ---------------------------------------------------------------------------
console.log("\n=== frontend verification (http://localhost:3000) ===");
const reasRes = await fetch(`${FRONTEND}/api/reasoning/${taskId}`);
const reas = await reasRes.json();
console.log(`GET /api/reasoning/${taskId} → ${reasRes.status}, ${reas.rows?.length ?? 0} verdict rows`);
const specRes = await fetch(`${FRONTEND}/api/specs/${taskId}`);
const spec = await specRes.json();
console.log(`GET /api/specs/${taskId} → ${specRes.status}, spec registered: ${Boolean(spec.spec_text)}`);
const pageRes = await fetch(`${FRONTEND}/task/${taskId}`);
console.log(`GET /task/${taskId} → ${pageRes.status}`);
console.log(`\nOPEN IN BROWSER: ${FRONTEND}/task/${taskId}`);
console.log("\nDONE — full gasless dispute lifecycle: create → dispute → Groq quorum → challenge → Senior Arbiter → settlement, all 0 gas for both users");