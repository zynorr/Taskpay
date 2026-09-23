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
  WSS_RPC_URL?: string;
  CHAIN_ID: number;
  CONTRACT_ADDRESS: string;
  POLL_INTERVAL_SECONDS: number;
  START_BLOCK?: number;
  GITHUB_TOKEN?: string;
  // Where the autonomous bots publish deliverable evidence: "owner/repo" (or a
  // GitHub URL). When set (and GITHUB_TOKEN is present) bots commit their
  // deliverables there and submit a pinned repo URL instead of inlining text
  // on-chain — full artifacts, fetchable by the dispute agents.
  GITHUB_EVIDENCE_REPO?: string;
  GITHUB_EVIDENCE_BRANCH_PREFIX?: string;
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
  // Autonomous agent daemon (bot/agent.ts). When AGENT_BOT_PRIVATE_KEY is set
  // the oracle also runs a self-operating TaskPay agent: it accepts tasks
  // created to its smart account (see lib docs), produces a deliverable with
  // Groq, and submits it — all through the same sponsored gasless path. The
  // bot is a distinct on-chain identity from the oracle operator.
  AGENT_BOT_PRIVATE_KEY?: string;
  AGENT_BOT_SESSION_KEY?: string;
  AGENT_BOT_NAME?: string;
  AGENT_BOT_POLL_SECONDS?: number;
  AGENT_BOT_ACCEPT_ALL?: boolean;
  AGENT_BOT_MODEL?: string;
  // AGENT_BOTS is the multi-agent roster: a JSON array that REPLACES the
  // single AGENT_BOT_PRIVATE_KEY config (legacy vars above are still the
  // fallback when it is absent). Each entry spawns one competing agent
  // identity — see AgentBotSpec below. Fields omitted per entry inherit the
  // shared AGENT_BOT_* defaults (poll cadence, model, accept-all).
  AGENT_BOT_SPECS?: AgentBotSpec[];
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * One competing agent identity. `privateKey` is the EOA that owns the
 * SimpleAccount acting on TaskPay; each key is a distinct on-chain identity.
 * `profile` optionally narrows which task specs the bot will take (keyword
 * match against the archived spec text); undefined means the built-in
 * default keyword profile. `pollSeconds`/`model`/`acceptAll` fall back to the
 * shared AGENT_BOT_* env defaults, then to code defaults.
 */
export interface AgentBotSpec {
  privateKey: string;
  sessionKey?: string;
  name: string;
  model?: string;
  pollSeconds?: number;
  acceptAll: boolean;
  profile?: string[];
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
  if (raw.AGENT_BOT_PRIVATE_KEY && !isValidPrivateKey(raw.AGENT_BOT_PRIVATE_KEY)) {
    errors.push("AGENT_BOT_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
  }
  if (raw.RPC_URL && !isValidUrl(raw.RPC_URL)) {
    errors.push("RPC_URL must be a valid URL.");
  }
  if (raw.WSS_RPC_URL && !isValidUrl(raw.WSS_RPC_URL)) {
    errors.push("WSS_RPC_URL must be a valid URL.");
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

  let agentBotPollSeconds: number | undefined;
  if (raw.AGENT_BOT_POLL_SECONDS !== undefined && raw.AGENT_BOT_POLL_SECONDS !== "") {
    agentBotPollSeconds = parsePositiveInt(raw.AGENT_BOT_POLL_SECONDS, "AGENT_BOT_POLL_SECONDS", errors);
  }

  // Multi-agent roster (AGENT_BOTS). When present it is authoritative and the
  // single-bot vars above are ignored for roster building (still used as
  // shared per-entry defaults). Each entry is validated independently so one
  // bad row reports its own error instead of failing the whole parse.
  let agentBotSpecs: AgentBotSpec[] | undefined;
  const rosterRaw = raw.AGENT_BOTS;
  if (rosterRaw !== undefined && rosterRaw.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rosterRaw);
    } catch (e) {
      errors.push(`AGENT_BOTS must be a JSON array of agent configs — parse failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    agentBotSpecs = [];
    if (Array.isArray(parsed)) {
      const acceptAllDefault = raw.AGENT_BOT_ACCEPT_ALL === "true";
      parsed.forEach((b, i) => {
        if (!b || typeof b !== "object") {
          errors.push(`AGENT_BOTS[${i}] must be an object with at least a \"key\".`);
          return;
        }
        const { key, name, model, pollSeconds, acceptAll, profile, sessionKey } = b as Record<string, unknown>;
        if (typeof key !== "string" || !isValidPrivateKey(key)) {
          errors.push(`AGENT_BOTS[${i}].key must be a 0x-prefixed 32-byte hex string.`);
          return;
        }
        const specPoll =
          typeof pollSeconds === "number" && Number.isInteger(pollSeconds) && pollSeconds > 0
            ? pollSeconds
            : agentBotPollSeconds;
        if (typeof pollSeconds === "number" && !(Number.isInteger(pollSeconds) && pollSeconds > 0)) {
          errors.push(`AGENT_BOTS[${i}].pollSeconds must be a positive integer.`);
        }
        if (model !== undefined && typeof model !== "string") {
          errors.push(`AGENT_BOTS[${i}].model must be a string.`);
        }
        if (profile !== undefined && (!Array.isArray(profile) || profile.some((k) => typeof k !== "string"))) {
          errors.push(`AGENT_BOTS[${i}].profile must be an array of keyword strings.`);
        }
        if (sessionKey !== undefined && (typeof sessionKey !== "string" || !isValidPrivateKey(sessionKey))) {
          errors.push(`AGENT_BOTS[${i}].sessionKey must be a 0x-prefixed 32-byte hex string.`);
        }
        agentBotSpecs!.push({
          privateKey: key,
          sessionKey: typeof sessionKey === "string" && sessionKey ? sessionKey : undefined,
          name: typeof name === "string" && name.trim() ? name.trim() : `Agent ${i + 1}`,
          model: typeof model === "string" && model ? model : raw.AGENT_BOT_MODEL || raw.GROQ_MODEL || undefined,
          pollSeconds: specPoll,
          acceptAll: typeof acceptAll === "boolean" ? acceptAll : acceptAllDefault,
          profile: Array.isArray(profile) ? (profile as string[]).map((k) => k.toLowerCase()) : undefined,
        });
      });
    } else if (parsed !== undefined) {
      errors.push("AGENT_BOTS must be a JSON array of agent configs.");
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
    WSS_RPC_URL: raw.WSS_RPC_URL || undefined,
    CHAIN_ID: chainId,
    CONTRACT_ADDRESS: raw.CONTRACT_ADDRESS!,
    POLL_INTERVAL_SECONDS: pollIntervalSeconds,
    START_BLOCK: startBlock,
    GITHUB_TOKEN: raw.GITHUB_TOKEN || undefined,
    GITHUB_EVIDENCE_REPO: raw.GITHUB_EVIDENCE_REPO || undefined,
    GITHUB_EVIDENCE_BRANCH_PREFIX: raw.GITHUB_EVIDENCE_BRANCH_PREFIX || undefined,
    MAX_REPO_BYTES: raw.ORACLE_MAX_REPO_BYTES ? Number(raw.ORACLE_MAX_REPO_BYTES) : undefined,
    DATA_DIR: raw.TASKPAY_DATA_DIR || path.resolve(__dirname, "../../../data"),
    ENTRY_POINT: raw.ENTRY_POINT || undefined,
    AA_FACTORY: raw.AA_FACTORY || undefined,
    PAYMASTER: raw.PAYMASTER || undefined,
    BUNDLER_RATE_LIMIT: bundlerRateLimit,
    AGENT_BOT_PRIVATE_KEY: raw.AGENT_BOT_PRIVATE_KEY || undefined,
    AGENT_BOT_NAME: raw.AGENT_BOT_NAME || "DevBot",
    AGENT_BOT_POLL_SECONDS: agentBotPollSeconds,
    AGENT_BOT_ACCEPT_ALL: raw.AGENT_BOT_ACCEPT_ALL === "true",
    AGENT_BOT_MODEL: raw.AGENT_BOT_MODEL || raw.GROQ_MODEL || undefined,
    AGENT_BOT_SESSION_KEY: raw.AGENT_BOT_SESSION_KEY || undefined,
    AGENT_BOT_SPECS: agentBotSpecs,
  };
}

export const env: OracleEnv = validate();

/**
 * The full agent roster the oracle should run. AGENT_BOTS (when configured) is
 * authoritative — it may even be an empty array (run zero agents). Without it,
 * the legacy single-bot AGENT_BOT_PRIVATE_KEY config builds a one-entry roster.
 */
export function agentBotSpecs(): AgentBotSpec[] {
  if (env.AGENT_BOT_SPECS) return env.AGENT_BOT_SPECS;
  if (env.AGENT_BOT_PRIVATE_KEY) {
    return [
      {
        privateKey: env.AGENT_BOT_PRIVATE_KEY,
        sessionKey: env.AGENT_BOT_SESSION_KEY,
        name: env.AGENT_BOT_NAME || "DevBot",
        model: env.AGENT_BOT_MODEL,
        pollSeconds: env.AGENT_BOT_POLL_SECONDS,
        acceptAll: env.AGENT_BOT_ACCEPT_ALL ?? false,
        profile: undefined,
      },
    ];
  }
  return [];
}
