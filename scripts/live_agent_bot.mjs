// Live end-to-end driver for the autonomous agent bot: a requester posts a
// task naming the bot's TaskPay account as the agent, registers the spec in
// the shared archive, and watches the bot accept and submit — all through
// sponsored ERC-4337 UserOps (the requester pays 0 gas; so does the bot).
//
// Prereqs:
//   1. Oracle built + running with the sponsor stack AND the bot enabled:
//        cd oracle && npm run build && AGENT_BOT_PRIVATE_KEY=... npm start
//   2. taskpay/.env (repo root) with:
//        RPC_URL, CHAIN_ID, CONTRACT_ADDRESS, AA_FACTORY, PAYMASTER,
//        PRIVATE_KEY (funder/deployer), AGENT_BOT_PRIVATE_KEY (the bot's EOA)
//
// Usage: node scripts/live_agent_bot.mjs
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
  console.log(`  tx: ${res.txHash}  (account ${quote.isDeployed ? "already deployed" : "deployed by this op"})`);
  return res;
}

// ---- 1. The bot's TaskPay identity (factory-derived SimpleAccount, salt 0) --
const botAccount = await factoryGetAddress(botOwner);
console.log("bot owner EOA:   ", botOwner);
console.log("bot TaskPay acct:", botAccount, "(designate this as the Agent on /create)");

// ---- 2. Requester (fresh EOA): fund EOA + pre-fund its smart account -------
const requester = Wallet.createRandom().connect(provider);
const requesterSmart = await factoryGetAddress(requester.address);
await (await deployer.sendTransaction({ to: requester.address, value: parseEther("0.05"), gasPrice: FUND_GAS_PRICE })).wait();
await (await deployer.sendTransaction({ to: requesterSmart, value: escrow, gasPrice: FUND_GAS_PRICE })).wait();
console.log("\nrequester EOA:   ", requester.address);
console.log("requester acct:  ", requesterSmart, "pre-funded", formatEther(escrow), "tBOT escrow");

// ---- 3. Compose a spec inside the bot's dev profile + register the archive --
const specText = `Implement a small TypeScript utility script (src/parse.ts) that parses a
comma-separated log line into a typed object with fields: timestamp, level,
service, and message. Export a function parseLine(line: string): ParsedLine
that trims whitespace, validates that the first field is a unix timestamp, and
throws a descriptive error on malformed input. Include a short README with
usage examples and a test file (parse.test.ts) with at least three cases.`;
const specHash = keccak256(toUtf8Bytes(specText.trim()));
const taskCount = Number(BigInt(await read("taskCount", []))); // id this create will mint
const taskId = taskCount;

// Register the spec in the shared archive exactly like the frontend's create
// flow does (POST /api/specs/[id]) — the bot only acts on archived specs.
mkdirSync(resolve(DATA_DIR, "specs", String(CHAIN_ID)), { recursive: true });
writeFileSync(
  resolve(DATA_DIR, "specs", String(CHAIN_ID), `${taskId}.json`),
  JSON.stringify(
    { chain_id: CHAIN_ID, task_id: taskId, spec_text: specText.trim(), spec_hash: specHash, name: "Parse log lines in TypeScript", created_at: new Date().toISOString() },
    null,
    2,
  ),
  "utf-8",
);
console.log("\nspec registered in archive (specs/" + CHAIN_ID + "/" + taskId + ".json)");
console.log("spec hash:", specHash);

// ---- 4. createTask — agent = the bot's account ------------------------------
console.log("\n[1] createTask (requester, sponsored) — task #" + taskId + ", agent = bot");
const createCall = taskPayIface.encodeFunctionData("createTask", [
  botAccount, specHash, 600n, 600n, 600n,
]);
await gasless(requester, createCall, escrow, "createTask");

// ---- 5. Watch the bot accept (poll; the bot ticks every AGENT_BOT_POLL_SECONDS)
console.log("\n[2] waiting for the bot to ACCEPT (spec-hash verified, profile-matched)...");
const acceptDeadline = Date.now() + 120_000;
let status;
for (;;) {
  status = Number((await read("getTask", [BigInt(taskId)])).status);
  if (status >= 1) break; // Accepted or beyond
  if (Date.now() > acceptDeadline) {
    console.error("timed out waiting for the bot to accept — is the oracle running with AGENT_BOT_PRIVATE_KEY set?");
    process.exit(1);
  }
  await sleep(4_000);
}
console.log(`  bot accepted (task status = ${status})`);

// ---- 6. Watch the bot submit a Groq-generated deliverable -------------------
console.log("\n[3] waiting for the bot to SUBMIT a deliverable (Groq generation takes a few seconds)...");
const submitDeadline = Date.now() + 180_000;
for (;;) {
  status = Number((await read("getTask", [BigInt(taskId)])).status);
  if (status >= 2) break; // Submitted or beyond
  if (Date.now() > submitDeadline) {
    console.error("timed out waiting for the bot to submit — check oracle logs (agent_bot_submitted)");
    process.exit(1);
  }
  await sleep(4_000);
}
const t = await read("getTask", [BigInt(taskId)]);
console.log(`  bot submitted (status = ${status})`);
console.log("  submission preview:", String(t.submission).slice(0, 160) + (t.submission.length > 160 ? "…" : ""));

// ---- 7. Release + rate — escrow lands in the bot's account ------------------
console.log("\n[4] release (requester, sponsored) — pays the bot's account");
await gasless(requester, taskPayIface.encodeFunctionData("release", [BigInt(taskId)]), 0n, "release");

console.log("\n[5] rateAgent 5/5 (requester, sponsored)");
await gasless(requester, taskPayIface.encodeFunctionData("rateAgent", [BigInt(taskId), 5]), 0n, "rateAgent");

const rating = await read("getAgentRatingSummary", [botAccount]);
const botBalance = await provider.getBalance(botAccount);
console.log("\nbot account balance:", formatEther(botBalance), "tBOT (escrow paid in, 0 gas spent)");
console.log(
  "bot rating:        ",
  rating.count > 0n ? (Number(rating.totalScore) / Number(rating.count)).toFixed(1) : "n/a",
  `(${rating.count.toString()} rating${rating.count === 1n ? "" : "s"})`,
);
console.log("\nDONE — the agent bot completed a full task lifecycle, all gasless");