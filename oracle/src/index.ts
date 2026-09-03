import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { ContractEventPoller } from "./contract/events.js";
import { handleDisputeRaised } from "./pipeline/handleDispute.js";
import { handleChallengeRaised } from "./pipeline/handleChallenge.js";
import { runAutoActionsScan } from "./pipeline/autoActions.js";

logger.info("oracle_starting", {
  contractAddress: env.CONTRACT_ADDRESS,
  chainId: env.CHAIN_ID,
  pollIntervalSeconds: env.POLL_INTERVAL_SECONDS,
  dataDir: env.DATA_DIR,
});

// Health check only (Render's free tier requires binding PORT and answering
// HTTP) — runs alongside the polling loop, not instead of it.
const port = Number(process.env.PORT) || 3000;
const healthServer = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "taskpay oracle running" }));
});
healthServer.listen(port, () => {
  logger.info("health_server_listening", { port });
});

const poller = new ContractEventPoller();
poller.onDisputeRaised((event) => handleDisputeRaised(event));
poller.onChallengeRaised((event) => handleChallengeRaised(event));
poller.start();

// Separate timer from the event poller: this scan enumerates every task by ID
// (not by event log) to catch deadline transitions that have no event to poll
// for (finalizeAfterReview / finalizeAfterChallenge /
// resolveAfterSeniorArbiterTimeout). `scanning` guards against overlap.
let scanning = false;
let currentScan: Promise<void> = Promise.resolve();
async function runScanTick(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    await runAutoActionsScan();
  } catch (err) {
    logger.error("auto_actions_scan_failed", { error: err instanceof Error ? err.message : String(err) });
  } finally {
    scanning = false;
  }
}
const scanTimer = setInterval(() => {
  currentScan = runScanTick();
}, env.POLL_INTERVAL_SECONDS * 1000);
currentScan = runScanTick();

logger.info("oracle_started");

async function shutdown(signal: string): Promise<void> {
  logger.info("oracle_shutting_down", { signal });
  poller.stop();
  clearInterval(scanTimer);
  healthServer.close();
  // Give in-flight work a chance to finish (Render sends SIGTERM on every
  // redeploy). Bounded so a stuck call can't block shutdown.
  await Promise.race([
    Promise.all([poller.waitForIdle(30_000), currentScan]),
    new Promise((resolve) => setTimeout(resolve, 30_000)),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
