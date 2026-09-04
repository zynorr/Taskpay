import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { isAddress } from "ethers";
import { logger } from "../lib/logger.js";

// .env lives at the repo root of this project (taskpay/.env), shared with the
// deploy script, not inside oracle/. Resolve relative to this file so it works
// regardless of process cwd, both under tsx (src/config) and compiled output
// (dist/config).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../../../.env");
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  // Not fatal on its own (Render/other hosts set vars directly); validate()
  // below still fails loud if anything required ends up missing.
  logger.warn("dotenv_load_failed", { envPath, error: dotenvResult.error.message });
}

export interface OracleEnv {
  ORACLE_PRIVATE_KEY: string;
  GROQ_API_KEY: string;
  GROQ_MODEL?: string;
  RPC_URL: string;
  CHAIN_ID: number;
  CONTRACT_ADDRESS: string;
  POLL_INTERVAL_SECONDS: number;
  START_BLOCK?: number;
  GITHUB_TOKEN?: string;
  MAX_REPO_BYTES?: number;
  DATA_DIR: string;
  // ERC-4337 sponsor stack (the oracle doubles as the bundler + paymaster signer).
  // Optional: when absent the bundler endpoints respond 503 and the oracle only
  // runs the dispute pipeline.
  ENTRY_POINT?: string;
  AA_FACTORY?: string;
  PAYMASTER?: string;
  // Max sponsored ops per address per minute (0 disables). Protects the open
  // sponsor endpoints from being drained as a free-gas faucet.
  BUNDLER_RATE_LIMIT?: number;
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isValidPrivateKey(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function parsePositiveInt(raw: string | undefined, key: string, errors: string[]): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    errors.push(`${key} must be a positive integer (got "${raw}").`);
    return NaN;
  }
  return parsed;
}

function validate(): OracleEnv {
  const errors: string[] = [];
  const raw = process.env;

  const required = [
    "ORACLE_PRIVATE_KEY",
    "GROQ_API_KEY",
    "RPC_URL",
    "CHAIN_ID",
    "CONTRACT_ADDRESS",
    "POLL_INTERVAL_SECONDS",
  ] as const;
  for (const key of required) {
    if (!raw[key] || raw[key].trim() === "") {
      errors.push(`${key} is missing.`);
    }
  }

  if (raw.ORACLE_PRIVATE_KEY && !isValidPrivateKey(raw.ORACLE_PRIVATE_KEY)) {
    errors.push("ORACLE_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  }
  if (raw.RPC_URL && !isValidUrl(raw.RPC_URL)) {
    errors.push("RPC_URL must be a valid URL.");
  }
  if (raw.CONTRACT_ADDRESS && !isAddress(raw.CONTRACT_ADDRESS)) {
    errors.push("CONTRACT_ADDRESS must be a valid Ethereum address.");
  }
  if (raw.GROQ_API_KEY && !/^gsk_/.test(raw.GROQ_API_KEY)) {
    errors.push("GROQ_API_KEY does not look like a valid Groq key (expected gsk_ prefix).");
  }

  let chainId = NaN;
  if (raw.CHAIN_ID) {
    chainId = parsePositiveInt(raw.CHAIN_ID, "CHAIN_ID", errors);
  }
  let pollIntervalSeconds = NaN;
  if (raw.POLL_INTERVAL_SECONDS) {
    pollIntervalSeconds = parsePositiveInt(raw.POLL_INTERVAL_SECONDS, "POLL_INTERVAL_SECONDS", errors);
  }

  let startBlock: number | undefined;
  if (raw.ORACLE_START_BLOCK) {
    startBlock = parsePositiveInt(raw.ORACLE_START_BLOCK, "ORACLE_START_BLOCK", errors);
  }

  let bundlerRateLimit: number | undefined;
  if (raw.ORACLE_BUNDLER_RATE_LIMIT !== undefined && raw.ORACLE_BUNDLER_RATE_LIMIT !== "") {
    bundlerRateLimit = Number(raw.ORACLE_BUNDLER_RATE_LIMIT);
    if (!Number.isInteger(bundlerRateLimit) || bundlerRateLimit < 0) {
      errors.push(`ORACLE_BUNDLER_RATE_LIMIT must be a non-negative integer (got "${raw.ORACLE_BUNDLER_RATE_LIMIT}").`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid oracle environment configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }

  return {
    ORACLE_PRIVATE_KEY: raw.ORACLE_PRIVATE_KEY!,
    GROQ_API_KEY: raw.GROQ_API_KEY!,
    GROQ_MODEL: raw.GROQ_MODEL || undefined,
    RPC_URL: raw.RPC_URL!,
    CHAIN_ID: chainId,
    CONTRACT_ADDRESS: raw.CONTRACT_ADDRESS!,
    POLL_INTERVAL_SECONDS: pollIntervalSeconds,
    START_BLOCK: startBlock,
    GITHUB_TOKEN: raw.GITHUB_TOKEN || undefined,
    MAX_REPO_BYTES: raw.ORACLE_MAX_REPO_BYTES ? Number(raw.ORACLE_MAX_REPO_BYTES) : undefined,
    DATA_DIR: raw.TASKPAY_DATA_DIR || path.resolve(__dirname, "../../../data"),
    ENTRY_POINT: raw.ENTRY_POINT || undefined,
    AA_FACTORY: raw.AA_FACTORY || undefined,
    PAYMASTER: raw.PAYMASTER || undefined,
    BUNDLER_RATE_LIMIT: bundlerRateLimit,
  };
}

export const env: OracleEnv = validate();
