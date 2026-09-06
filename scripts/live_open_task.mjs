// Live end-to-end driver for OPEN tasks (first come, first served): the
// requester posts with agent = 0x0 (unclaimed), any agent can claim via
// acceptTask — the chain itself picks exactly one winner — and the built-in
// agent bot (watching TaskCreated events + polling getOpenTasks) races to
// claim, generate a Groq deliverable, and submit. All sponsored UserOps.
//
// Prereqs: same as live_agent_bot.mjs — oracle running with the sponsor stack
// AND AGENT_BOT_PRIVATE_KEY set, taskpay/.env configured for testnet.
//
// Usage: node scripts/live_open_task.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ethersPath = pathToFileURL(resolve(__dirname, "../oracle/node_modules/ethers/lib.esm/index.js")).href;
const { Wallet, Interface, JsonRpcProvider, getBytes, parseEther, parseUnits, formatEther, keccak256, toUtf8Bytes } =
  await import(ethersPath);

const dotenv = await import(pathToFileURL(resolve(__dirname, "../oracle/node_modules/dotenv/lib/main.js")).href);
dotenv.config({ path: resolve(__dirname, "../.env") });

const { buildQuote, sendUserOp } = await import(
  pathToFileURL(resolve(__dirname, "../oracle/dist/bundler/userop.js")).href
);

const RPC = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID);
const CONTRACT = process.env.CONTRACT_ADDRESS;
const AA_FACTORY = process.env.AA_FACTORY;
const DATA_DIR = process.env.TASKPAY_DATA_DIR ?? resolve(__dirname, "../data");

const ZERO = "0x0000000000000000000000000000000000000000";

const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const deployer = new Wallet(process.env.PRIVATE_KEY, provider);
const botOwner = new Wallet(process.env.AGENT_BOT_PRIVATE_KEY, provider).address;

const taskPayIface = new Interface(JSON.parse(readFileSync(resolve(__dirname, "../out/TaskPay.sol/TaskPay.json"), "utf8")).abi);
const factoryIface = new Interface(
  JSON.parse(readFileSync(resolve(__dirname, "../out/SimpleAccountFactory.sol/SimpleAccountFactory.json"), "utf8")).abi,
);

const escrow = parseEther("0.01");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Funding sends use an explicit gas price: the public RPC's eth_gasPrice hint
// can lag the real inclusion floor (observed after an RPC outage), and ethers'
// 20 gwei default then hangs unmined in the mempool.
const FUND_GAS_PRICE = parseUnits("80", "gwei");

async function read(name, args) {
  const data = taskPayIface.encodeFunctionData(name, args);
  const res = await provider.call({ to: CONTRACT, data });
  const dec = taskPayIface.decodeFunctionResult(name, res);
  return dec.length === 1 ? dec[0] : dec;
}
async function factoryGetAddress(owner) {
  const data = factoryIface.encodeFunctionData("getAddress", [owner, 0n]);
  const res = await provider.call({ to: AA_FACTORY, data });
  return factoryIface.decodeFunctionResult("getAddress", res)[0];
}
async function gasless(owner, targetCall, value, label) {
  console.log(`  ...quoting ${label}`);
  const quote = await buildQuote({ owner: owner.address, target: CONTRACT, callData: targetCall, value });
  quote.userOp.signature = await owner.signMessage(getBytes(quote.userOpHash));
  const res = await sendUserOp(quote.userOp);
  console.log(`  tx: ${res.txHash}`);
  return res;
}

// ---- 1. Identities ----------------------------------------------------------
const botAccount = await factoryGetAddress(botOwner);
console.log("bot TaskPay acct:", botAccount, "(expected claimer)");

// ---- 2. Requester (fresh EOA): fund EOA + pre-fund its smart account --------
const requester = Wallet.createRandom().connect(provider);
const requesterSmart = await factoryGetAddress(requester.address);
await (await deployer.sendTransaction({ to: requester.address, value: parseEther("0.05"), gasPrice: FUND_GAS_PRICE })).wait();
await (await deployer.sendTransaction({ to: requesterSmart, value: escrow, gasPrice: FUND_GAS_PRICE })).wait();
console.log("requester acct:  ", requesterSmart, "pre-funded", formatEther(escrow), "tBOT escrow");

// ---- 3. Spec inside the bot's dev profile + archive registration ------------
const specText = `Build a tiny Node.js CLI (scripts/wordcount.mjs) that reads a file path
from argv, counts word occurrences, and prints the top 5 words with counts in
descending order. Handle missing files with a clear error message and exit
code 1. Include three example unit tests using node:test.`;
const specHash = keccak256(toUtf8Bytes(specText.trim()));
const taskCount = Number(BigInt(await read("taskCount", [])));
const taskId = taskCount;

mkdirSync(resolve(DATA_DIR, "specs", String(CHAIN_ID)), { recursive: true });
writeFileSync(
  resolve(DATA_DIR, "specs", String(CHAIN_ID), `${taskId}.json`),
  JSON.stringify(
    { chain_id: CHAIN_ID, task_id: taskId, spec_text: specText.trim(), spec_hash: specHash, name: "Word-count CLI in Node", created_at: new Date().toISOString() },
    null,
    2,
  ),
  "utf-8",
);
console.log("spec registered in archive (specs/" + CHAIN_ID + "/" + taskId + ".json)");

// ---- 4. createOpenTask — agent UNSET + reputation floor (v3) -----------------
const MIN_RATING = 4n; // bot holds 5.0 avg — should clear; unrated agents cannot
console.log("\n[1] createOpenTask (requester, sponsored) — task #" + taskId + ", agent = 0x0, minRating " + MIN_RATING);
const createCall = taskPayIface.encodeFunctionData("createOpenTask", [
  specHash, 600n, 600n, 600n, MIN_RATING,
]);
const t0 = Date.now();
await gasless(requester, createCall, escrow, "createOpenTask");

const floor = BigInt(await read("minRatingOf", [BigInt(taskId)]));
if (floor !== MIN_RATING) throw new Error("minRatingOf mismatch: " + floor);
console.log("  on-chain floor confirmed (minRatingOf = " + floor + ")");

// Confirm the on-chain state is an unclaimed open task.
const fresh = await read("getTask", [BigInt(taskId)]);
if (fresh.agent !== ZERO) throw new Error("task is not open — agent was set: " + fresh.agent);
const openIds = (await read("getOpenTasks", [])).map((x) => Number(x));
if (!openIds.includes(taskId)) throw new Error("getOpenTasks does not include task #" + taskId);
console.log("  on-chain open task confirmed (getOpenTasks → [" + openIds.join(", ") + "])");

// ---- 5. Watch ANY agent claim — first come, first served --------------------
console.log("\n[2] waiting for the FIRST agent to claim (event hook + poll fallback race)...");
const claimDeadline = Date.now() + 120_000;
let status;
let claimedAt = null;
for (;;) {
  const t = await read("getTask", [BigInt(taskId)]);
  status = Number(t.status);
  if (status >= 1) {
    claimedAt = Date.now();
    break;
  }
  if (Date.now() > claimDeadline) {
    console.error("timed out waiting for any agent to claim — is the oracle running with AGENT_BOT_PRIVATE_KEY?");
    process.exit(1);
  }
  await sleep(3_000);
}
console.log(`  claimed after ${((claimedAt - t0) / 1000).toFixed(1)}s from create`);
console.log(`  claimer: ${fresh.agent === ZERO ? "(see below)" : fresh.agent}`);
const claimed = await read("getTask", [BigInt(taskId)]);
console.log(`  task.agent now: ${claimed.agent}`);
if (claimed.agent.toLowerCase() === botAccount.toLowerCase()) {
  console.log("  ✓ the agent bot won the first-come-first-served race");
} else {
  console.log("  (a different agent claimed it — also valid for an open task)");
}

// ---- 6. Watch the claimer submit a deliverable -------------------------------
console.log("\n[3] waiting for the claimer to SUBMIT a deliverable (Groq generation takes a few seconds)...");
const submitDeadline = Date.now() + 180_000;
for (;;) {
  status = Number((await read("getTask", [BigInt(taskId)])).status);
  if (status >= 2) break;
  if (Date.now() > submitDeadline) {
    console.error("timed out waiting for the submission — check oracle logs (agent_bot_submitted)");
    process.exit(1);
  }
  await sleep(4_000);
}
const t = await read("getTask", [BigInt(taskId)]);
console.log(`  submitted (status = ${status})`);
console.log("  submission preview:", String(t.submission).slice(0, 160) + (t.submission.length > 160 ? "…" : ""));

// ---- 7. Release + rate — escrow lands in the claimer's account ---------------
console.log("\n[4] release (requester, sponsored) — pays the claimer's account");
await gasless(requester, taskPayIface.encodeFunctionData("release", [BigInt(taskId)]), 0n, "release");

console.log("\n[5] rateAgent 5/5 (requester, sponsored)");
await gasless(requester, taskPayIface.encodeFunctionData("rateAgent", [BigInt(taskId), 5]), 0n, "rateAgent");

const rating = await read("getAgentRatingSummary", [claimed.agent]);
const botBalance = await provider.getBalance(claimed.agent);
console.log("\nclaimer balance:", formatEther(botBalance), "tBOT (escrow paid in, 0 gas spent)");
console.log(
  "claimer rating:  ",
  rating.count > 0n ? (Number(rating.totalScore) / Number(rating.count)).toFixed(1) : "n/a",
  `(${rating.count.toString()} rating${rating.count === 1n ? "" : "s"})`,
);
console.log("\nDONE — open task lifecycle complete: post open → claim → submit → release → rate");
