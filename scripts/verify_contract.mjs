// Verify a deployed contract's source on the BOT Chain explorer (Blockscout)
// via its Etherscan-compatible v1 API, using the exact build settings recorded
// in the Foundry artifact (compiler, evm, optimizer, via-IR) so the explorer
// recompiles byte-for-byte. Works for any contract in this repo with an
// artifact under out/, e.g. out/TaskPay.sol/TaskPay.json.
//
// Usage:
//   node scripts/verify_contract.mjs <artifact-relative-path> [address] [explorer-base]
//     artifact path is relative to out/, e.g. "TaskPay.sol/TaskPay.json"
//     address defaults to CONTRACT_ADDRESS in ../.env
//     explorer base defaults to https://scan.bohr.life
//
// Requires the contract's sources to be present in this repo. Import paths are
// resolved via the @openzeppelin/ → lib/openzeppelin-contracts/contracts/
// remapping, and the standard-JSON "sources" keys are named by the import
// paths the files actually use (standard JSON has no implicit remappings).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dotenv = await import(pathToFileURL(resolve(__dirname, "../oracle/node_modules/dotenv/lib/main.js")).href);
dotenv.config({ path: resolve(__dirname, "../.env") });

const [artifactRel = "TaskPay.sol/TaskPay.json", addressArg, explorerArg] = process.argv.slice(2);
const EXPLORER = explorerArg ?? "https://scan.bohr.life";
const address = addressArg ?? process.env.CONTRACT_ADDRESS;
if (!address) throw new Error("no address — pass one or set CONTRACT_ADDRESS");

const artifactPath = resolve(__dirname, "../out", artifactRel);
if (!existsSync(artifactPath)) throw new Error(`no artifact at ${artifactPath}`);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
const meta = artifact.metadata;
if (!meta) throw new Error(`artifact has no metadata (is it a verified build?): ${artifactPath}`);

const OZ_DISK = "lib/openzeppelin-contracts/contracts/";
const OZ_IMPORT = "@openzeppelin/contracts/";

const importPathOf = (key) =>
  key.startsWith(OZ_DISK) ? OZ_IMPORT + key.slice(OZ_DISK.length) : key;
const resolveSource = (importPath) => {
  const disk = importPath.startsWith(OZ_IMPORT) ? OZ_DISK + importPath.slice(OZ_IMPORT.length) : importPath;
  const full = resolve(__dirname, "../", disk);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
};

const sources = {};
for (const key of Object.keys(meta.sources)) {
  const importPath = importPathOf(key);
  const content = resolveSource(importPath);
  if (content === null) throw new Error(`cannot find source file for ${key}`);
  sources[importPath] = { content };
}

const standardJsonInput = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: meta.settings.optimizer,
    evmVersion: meta.settings.evmVersion,
    viaIR: meta.settings.viaIR ?? true,
  },
};

const contractName = Object.keys(meta.settings.compilationTarget)[0] ?? artifactRel;
console.log(`Verifying ${contractName}`);
console.log(`  address   ${address}`);
console.log(`  solc      ${meta.compiler.version} · evm ${standardJsonInput.settings.evmVersion} · optimizer ${standardJsonInput.settings.optimizer.enabled} (${standardJsonInput.settings.optimizer.runs}) · via-ir ${standardJsonInput.settings.viaIR}`);
console.log(`  sources   ${Object.keys(sources).join(", ")}`);

async function postVerify(fields) {
  const form = new URLSearchParams();
  form.set("module", "contract");
  form.set("action", "verifysourcecode");
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  const res = await fetch(`${EXPLORER}/api`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return res.json();
}

async function pollStatus(guid, tries = 10, intervalMs = 15_000) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await (await fetch(`${EXPLORER}/api?module=contract&action=checkverifystatus&guid=${guid}`)).json();
    const status = res.result ?? "";
    console.log(`  status: ${status}`);
    if (status.includes("Pass")) return true;
    if (status.includes("Fail")) return false;
  }
  throw new Error(`timed out waiting for verification of ${guid}`);
}

const result = await postVerify({
  contractaddress: address,
  contractname: contractName,
  compilerversion: meta.compiler.version,
  codeformat: "solidity-standard-json-input",
  sourceCode: JSON.stringify(standardJsonInput),
  licenseType: "3", // MIT — see docs.blockscout.com license type list
  autodetectConstructorArguments: "true",
});

console.log(`\nsubmit → ${result.message ?? JSON.stringify(result)}`);
if (result.status !== "1" || !result.result) {
  console.error("verification not accepted (see above)");
  process.exit(1);
}

if (await pollStatus(result.result)) {
  console.log(`✅ verified — ${EXPLORER}/address/${address}#code`);
} else {
  console.error(`❌ verification failed — ${EXPLORER}/address/${address}#code`);
  process.exit(1);
}