import type { EventLog } from "ethers";
import { rawContract, provider } from "./client.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

type FilterName = "DisputeRaised" | "ChallengeRaised";

// Block the contract was deployed at — set after the first real deployment
// (see DEPLOY.md). Used as the default backstop so a fresh process replays the
// full event history rather than silently missing anything that predates it.
// Override with ORACLE_START_BLOCK (optional) after a redeploy.
const DEFAULT_START_BLOCK = 0;
const startBlockOverride = env.START_BLOCK;

// BOT Chain produces a block every ~0.75s, so 2000 blocks is only ~25 minutes.
// eth_getLogs caps on public RPCs are commonly 2k-10k blocks; keep chunks small
// so a cold catch-up replay never trips a provider cap.
const MAX_BLOCK_RANGE = 2000;

// Process-lifetime dedup window, sized far beyond any realistic reorg depth.
const DEDUP_RETENTION_BLOCKS = 20_000;

export interface DisputeRaisedEvent {
  taskId: bigint;
  requester: string;
  reason: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

export interface ChallengeRaisedEvent {
  taskId: bigint;
  challenger: string;
  reasoningHash: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

type Handler<E> = (event: E) => Promise<void> | void;

interface EventSource<E> {
  filterName: FilterName;
  parse: (log: EventLog) => E;
  handler: Handler<E>;
}

function makeSource<E>(filterName: FilterName, parse: (log: EventLog) => E, handler: Handler<E>): EventSource<E> {
  return { filterName, parse, handler };
}

// Polls all registered sources on one shared interval using a single
// getBlockNumber + one queryFilter per source per chunk. Idempotency here is a
// process-lifetime backstop only (dedupes a log returned twice, e.g. across an
// overlapping chunk boundary); the authoritative double-submit guard lives in
// verdict/submit.ts, which checks live on-chain vote state before writing.
// No persisted cursor: a restart resumes from the start block and re-derives
// everything live from the chain in bounded chunks (never mirror on-chain
// state as a source of truth).
export class ContractEventPoller {
  private lastProcessedBlock: number;
  private readonly processedKeys = new Map<string, number>(); // key -> blockNumber
  private readonly sources: EventSource<unknown>[] = [];
  private timer?: NodeJS.Timeout;
  private polling = false;
  private currentTick: Promise<void> = Promise.resolve();

  constructor(startBlock: number = startBlockOverride ?? DEFAULT_START_BLOCK) {
    this.lastProcessedBlock = startBlock - 1;
  }

  onDisputeRaised(handler: Handler<DisputeRaisedEvent>): this {
    this.sources.push(
      makeSource(
        "DisputeRaised",
        (log) => ({
          taskId: log.args.taskId as bigint,
          requester: log.args.requester as string,
          reason: log.args.reason as string,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.index,
        }),
        handler,
      ) as EventSource<unknown>,
    );
    return this;
  }

  onChallengeRaised(handler: Handler<ChallengeRaisedEvent>): this {
    this.sources.push(
      makeSource(
        "ChallengeRaised",
        (log) => ({
          taskId: log.args.taskId as bigint,
          challenger: log.args.challenger as string,
          reasoningHash: log.args.reasoningHash as string,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.index,
        }),
        handler,
      ) as EventSource<unknown>,
    );
    return this;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.currentTick = this.tick().catch((err: unknown) => {
        logger.error("event_poller_tick_failed", { error: err instanceof Error ? err.message : String(err) });
      });
    }, env.POLL_INTERVAL_SECONDS * 1000);
    this.currentTick = this.tick().catch((err: unknown) => {
      logger.error("event_poller_initial_tick_failed", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Lets shutdown wait for an in-flight tick (and the handlers it started)
  // rather than killing mid-AI-call or mid-transaction on SIGTERM. Bounded so
  // a stuck call can't block shutdown forever.
  async waitForIdle(timeoutMs: number): Promise<void> {
    await Promise.race([this.currentTick, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  private async tick(): Promise<void> {
    if (this.polling) return; // don't let ticks overlap if a poll runs long
    if (this.sources.length === 0) return;
    this.polling = true;
    try {
      const latestBlock = await provider.getBlockNumber();
      let windowStart = this.lastProcessedBlock + 1;
      if (windowStart > latestBlock) return;

      while (windowStart <= latestBlock) {
        const windowEnd = Math.min(windowStart + MAX_BLOCK_RANGE - 1, latestBlock);

        const results = await Promise.all(
          this.sources.map((source) => rawContract.queryFilter(source.filterName, windowStart, windowEnd)),
        );

        for (let i = 0; i < this.sources.length; i++) {
          const source = this.sources[i]!;
          for (const log of results[i]!) {
            const eventLog = log as EventLog;
            const key = `${eventLog.transactionHash}:${eventLog.index}`;
            if (this.processedKeys.has(key)) continue;
            this.processedKeys.set(key, eventLog.blockNumber);
            // Isolate per-event failures: one task's error must not block the
            // rest of the batch (each handler also try/catches internally).
            try {
              await source.handler(source.parse(eventLog));
            } catch (err) {
              logger.error("event_handler_failed", {
                filter: source.filterName,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        // In-memory progress only; a restart re-derives from the chain.
        this.lastProcessedBlock = windowEnd;
        windowStart = windowEnd + 1;
      }

      const pruneBefore = this.lastProcessedBlock - DEDUP_RETENTION_BLOCKS;
      for (const [key, blockNumber] of this.processedKeys) {
        if (blockNumber < pruneBefore) this.processedKeys.delete(key);
      }
    } finally {
      this.polling = false;
    }
  }
}
