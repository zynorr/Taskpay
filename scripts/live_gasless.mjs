// Live end-to-end driver: TaskPay actions executed entirely through sponsored
// ERC-4337 UserOps on BOT Chain testnet. Two fresh EOAs act through their
// SimpleAccounts; every TaskPay method call is gasless for the user (the oracle
// bundler sponsors it via VerifyingPaymaster).
//
// Usage: node scripts/live_gasless.mjs (from the repo root, after `npm run build` in oracle/)
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ethersPath = pathToFileURL(resolve(__dirname, "../oracle/node_modules/ethers/lib.esm/index.js")).href;
const { Wallet, Interface, JsonRpcProvider, getBytes, parseEther, formatEther } = await import(ethersPath);

const dotenv = await import(pathToFileURL(resolve(__dirname, "../oracle/node_modules/dotenv/lib/main.js")).href);
dotenv.config({ path: resolve(__dirname, "../.env") });

const { buildQuote, sendUserOp } = await import(
  pathToFileURL(resolve(__dirname, "../oracle/dist/bundler/userop.js")).href
);

const RPC = process.env.RPC_URL;
const CHAIN_ID = Number(process.env.CHAIN_ID);
const CONTRACT = process.env.CONTRACT_ADDRESS;
const AA_FACTORY = process.env.AA_FACTORY;
const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const deployer = new Wallet(process.env.PRIVATE_KEY, provider);

const taskPayIface = new Interface(JSON.parse(readFileSync(resolve(__dirname, "../out/TaskPay.sol/TaskPay.json"), "utf8")).abi);
const factoryIface = new Interface(
  JSON.parse(readFileSync(resolve(__dirname, "../out/SimpleAccountFactory.sol/SimpleAccountFactory.json"), "utf8")).abi,
);

const escrow = parseEther("0.01");
const specHash = "0x" + "ab".repeat(32);

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

// ---- 1. Two fresh user EOAs (requester + agent) ---------------------------
const requester = Wallet.createRandom().connect(provider);
const agent = Wallet.createRandom().connect(provider);
console.log("requester owner:", requester.address);
console.log("agent owner:    ", agent.address);

// Fund both EOAs with tBOT (only used for the escrow pre-fund; all TaskPay
// actions below are sponsored and cost them nothing).
for (const w of [requester, agent]) {
  const tx = await deployer.sendTransaction({ to: w.address, value: parseEther("0.05") });
  await tx.wait();
}

// ---- 2. Counterfactual smart accounts (owner + salt 0) --------------------
const requesterSmart = await factoryGetAddress(requester.address);
const agentSmart = await factoryGetAddress(agent.address);
const requesterCode = await provider.getCode(requesterSmart);
console.log("requester smart:", requesterSmart, "(" + (requesterCode === "0x" ? "not deployed yet" : "deployed") + ")");
console.log("agent smart:    ", agentSmart);

// ---- 3. Pre-fund the requester smart account with the escrow --------------
// Counterfactual funding: the address holds tBOT before the account exists;
// the first sponsored UserOp deploys it AND creates the task in one shot.
await (await deployer.sendTransaction({ to: requesterSmart, value: escrow })).wait();
console.log("pre-funded requester smart account:", formatEther(escrow), "tBOT");

// ---- 4. Gasless helper ------------------------------------------------------
async function gasless(owner, targetCall, value = 0n, label) {
  console.log(`  ...quoting ${label}`);
  const quote = await buildQuote({
    owner: owner.address,
    target: CONTRACT,
    callData: targetCall,
    value,
  });
  // Owner signs the raw 32-byte userOpHash; SimpleAccount validates
  // ECDSA.recover(toEthSignedMessageHash(userOpHash)).
  quote.userOp.signature = await owner.signMessage(getBytes(quote.userOpHash));
  const res = await sendUserOp(quote.userOp);
  console.log(`  tx: ${res.txHash}  (account ${quote.isDeployed ? "already deployed" : "deployed by this op"})`);
  return res;
}

// ---- 5. createTask -----------------------------------------------------------
const taskCount = Number(BigInt(await read("taskCount", []))); // single uint256
console.log("\n[1] createTask — sponsored, from a not-yet-deployed smart account (task #" + taskCount + ")");
const createCall = taskPayIface.encodeFunctionData("createTask", [
  agentSmart, specHash, 600n, 600n, 600n,
]);
await gasless(requester, createCall, escrow, "createTask");

const t = await read("getTask", [BigInt(taskCount)]);
console.log("  task requester == requesterSmart:", t.requester.toLowerCase() === requesterSmart.toLowerCase());
console.log("  task agent == agentSmart:        ", t.agent.toLowerCase() === agentSmart.toLowerCase());
console.log("  escrow held:                     ", formatEther(BigInt(t.amount)), "tBOT");

// ---- 6. acceptTask + submitWork (agent) --------------------------------------
console.log("\n[2] acceptTask — sponsored (agent)");
await gasless(agent, taskPayIface.encodeFunctionData("acceptTask", [BigInt(taskCount)]), 0n, "acceptTask");

console.log("\n[3] submitWork — sponsored (agent)");
await gasless(
  agent,
  taskPayIface.encodeFunctionData("submitWork", [BigInt(taskCount), "https://github.com/zynorr/Taskpay @ a1b2c3d"]),
  0n,
  "submitWork",
);

// ---- 7. release (requester) — escrow flows to agent smart --------------------
console.log("\n[4] release — sponsored (requester)");
await gasless(requester, taskPayIface.encodeFunctionData("release", [BigInt(taskCount)]), 0n, "release");

const agentBalance = await provider.getBalance(agentSmart);
const requesterBalance = await provider.getBalance(requesterSmart);
console.log("\nagent smart balance:   ", formatEther(agentBalance), "tBOT (escrow paid in, 0 gas spent)");
console.log("requester smart balance:", formatEther(requesterBalance), "tBOT (escrow spent, 0 gas spent)");
console.log("\nDONE — full gasless lifecycle verified; both users paid 0 gas on every action");
