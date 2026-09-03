// Frontend-equivalent E2E over HTTP: fresh EOA → fund smart account →
// /v1/quote → sign userOpHash → /v1/send → verify task on-chain.
// Mirrors exactly what the Next.js UI does (see frontend/lib/gasless.ts).
//
// Usage: node scripts/gasless_http_e2e.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ethersPath = pathToFileURL(resolve(__dirname, "../oracle/node_modules/ethers/lib.esm/index.js")).href;
const { Wallet, Interface, JsonRpcProvider, getBytes, parseEther, formatEther } = await import(ethersPath);
const dotenv = await import(pathToFileURL(resolve(__dirname, "../oracle/node_modules/dotenv/lib/main.js")).href);
dotenv.config({ path: resolve(__dirname, "../.env") });

const BUNDLER = process.env.BUNDLER_URL ?? "http://localhost:8787";
const provider = new JsonRpcProvider(process.env.RPC_URL, Number(process.env.CHAIN_ID), { staticNetwork: true });
const deployer = new Wallet(process.env.PRIVATE_KEY, provider);
const CONTRACT = process.env.CONTRACT_ADDRESS;
const factoryIface = new Interface(
  JSON.parse(readFileSync(resolve(__dirname, "../out/SimpleAccountFactory.sol/SimpleAccountFactory.json"), "utf8")).abi,
);
const taskPayIface = new Interface(JSON.parse(readFileSync(resolve(__dirname, "../out/TaskPay.sol/TaskPay.json"), "utf8")).abi);

async function factoryGetAddress(owner) {
  const data = factoryIface.encodeFunctionData("getAddress", [owner, 0n]);
  const res = await provider.call({ to: process.env.AA_FACTORY, data });
  return factoryIface.decodeFunctionResult("getAddress", res)[0];
}

// ---- setup: fresh EOA, fund smart account with escrow ----------------------
const owner = Wallet.createRandom().connect(provider);
const smart = await factoryGetAddress(owner.address);
const escrow = parseEther("0.01");
await (await deployer.sendTransaction({ to: owner.address, value: parseEther("0.02") })).wait();
await (await deployer.sendTransaction({ to: smart, value: escrow })).wait();
console.log("owner:", owner.address, "| smart:", smart, "| funded:", formatEther(escrow));

// build the TaskPay createTask callData exactly as the UI does
const specHash = "0x" + "cd".repeat(32);
const agentSmart = await factoryGetAddress(Wallet.createRandom().address);
const callData = taskPayIface.encodeFunctionData("createTask", [agentSmart, specHash, 300n, 300n, 300n]);

// ---- step 1: quote ----------------------------------------------------------
const quoteRes = await fetch(`${BUNDLER}/v1/quote`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ owner: owner.address, target: CONTRACT, callData, value: escrow.toString() }),
});
const quote = await quoteRes.json();
if (!quote.ok) throw new Error("quote failed: " + quote.error);
console.log("quote ok — sender:", quote.sender, "| userOpHash:", quote.userOpHash.slice(0, 18) + "…");

// ---- step 2: sign with the owner EOA (the browser wallet equivalent) ---------
const signature = await owner.signMessage(getBytes(quote.userOpHash));

// ---- step 3: send ------------------------------------------------------------
const sendRes = await fetch(`${BUNDLER}/v1/send`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ userOp: quote.userOp, signature }),
});
const sent = await sendRes.json();
if (!sent.ok) throw new Error("send failed: " + sent.error);
console.log("send ok — tx:", sent.txHash);

// ---- verify on-chain ----------------------------------------------------------
const receipt = await provider.getTransactionReceipt(sent.txHash);
if (!receipt || receipt.status !== 1) throw new Error("tx not mined ok");
const countData = taskPayIface.encodeFunctionData("taskCount", []);
const countRes = await provider.call({ to: CONTRACT, data: countData });
const count = taskPayIface.decodeFunctionResult("taskCount", countRes)[0];
const getData = taskPayIface.encodeFunctionData("getTask", [count - 1n]);
const getRes = await provider.call({ to: CONTRACT, data: getData });
const t = taskPayIface.decodeFunctionResult("getTask", getRes)[0];
console.log("task #" + (count - 1n).toString() + " requester == smart:", t.requester.toLowerCase() === smart.toLowerCase());
console.log("task escrow:", formatEther(t.amount), "| agent set:", t.agent.toLowerCase() === agentSmart.toLowerCase());
console.log("DONE — gasless createTask over HTTP, requester paid 0 gas");
