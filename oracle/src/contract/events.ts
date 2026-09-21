import fs from "node:fs/promises";
import path from "node:path";
import { Interface, type EventFilter, type EventLog, type Log } from "ethers";
import { rawContract, provider, wsProvider } from "./client.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import abi from "./TaskPay.abi.json" with { type: "json" };

// Topic filters for the WS subscription are built from the same ABI the contract
// clients use, so event names can never drift from their on-chain signatures.
const contractInterface = new Interface(abi);

type FilterName = "DisputeRaised" | "ChallengeRaised" | "TaskCreated";

// Boot cursor strategy (highest priority first):
//   1. ORACLE_START_BLOCK env override — explicit manual pin (redeploys etc).
//   2. Persisted cursor (data/poller-cursor.json) — resumes where the last
//      process left off, so a plain restart never re-replays history.
//   3. head minus DEFAULT_BACKFILL_BLOCKS — only when there is no cursor at
//      all (fresh data dir / ephemeral host): a cold boot catches up in a few
//      chunks instead of replaying from block 0 (hours behind on a live
//      chain). Events older than the margin are not re-triggered; disputes
//      stuck without a quorum are surfaced by the stall scanner instead.
const startBlockOverride = env.START_BLOCK;

// ~4h of BOT Chain history (0.75s blocks): big enough to bridge typical
// downtime, small enough that the first boot's catch-up burst finishes fast.
const DEFAULT_BACKFILL_BLOCKS = 20_000;

// Cursor file lives in the shared data dir next to the dispute/reasoning
// archives so it survives across processes and matches how the store modules
// persist state. Keyed by chain id to stay correct if DATA_DIR is shared.
const cursorFile = () => path.join(env.DATA_DIR, "poller-cursor.json");

// BOT Chain produces a block every ~0.75s, so 2000 blocks is only ~25 minutes.
// eth_getLogs caps on public RPCs are commonly 2k-10k blocks; keep chunks small
// so a cold catch-up replay never trips a provider cap.
const MAX_BLOCK_RANGE = 2000;

// Process-lifetime dedup window, sized far beyond any realistic reorg depth.
const DEDUP_RETENTION_BLOCKS = 20_000;

// WS mode never runs the HTTP poll's prune step, so the dedup map is pruned
// inside dispatch() instead, throttled to once per this many blocks.
const PRUNE_INTERVAL_BLOCKS = 1000;

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

export interface TaskCreatedEvent {
  taskId: bigint;
  requester: string;
  agent: string; // 0x0 for open (first-come-first-served) tasks
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
// A per-tick cursor is persisted to data/poller-cursor.json so restarts resume
// where the previous process stopped (see resolveCursor for the boot order);
// the chain remains the source of truth, never the mirror.
export class ContractEventPoller {
  private lastProcessedBlock = -1; // resolved lazily on the first tick
  private cursorResolved = false;
  private readonly startBlockOverride: number | null;
  private readonly processedKeys = new Map<string, number>(); // key -> blockNumber
  private readonly sources: EventSource<unknown>[] = [];
  private readonly wsSubscriptions: { filter: EventFilter; listener: (log: Log) => void }[] = [];
  private timer?: NodeJS.Timeout;
  private polling = false;
  private currentTick: Promise<void> = Promise.resolve();
  private nextPruneBlock = 0;

  constructor(startBlock: number | null = startBlockOverride ?? null) {
    this.startBlockOverride = startBlock;
  }

  // Pick the effective start of the next poll window, in priority order:
  // env override → persisted cursor → head minus a backfill margin. Needs a
  // network call (head) only on the no-cursor cold-boot path.
  private async resolveCursor(): Promise<void> {
    if (this.startBlockOverride !== null) {
      this.lastProcessedBlock = this.startBlockOverride - 1;
      logger.info("event_poller_start", { source: "override", startBlock: this.startBlockOverride });
      return;
    }
    try {
      const raw = JSON.parse(await fs.readFile(cursorFile(), "utf-8")) as {
        chain_id?: unknown;
        last_processed_block?: unknown;
      };
      if (
        raw.chain_id === env.CHAIN_ID &&
        typeof raw.last_processed_block === "number" &&
        Number.isInteger(raw.last_processed_block) &&
        raw.last_processed_block >= 0
      ) {
        this.lastProcessedBlock = raw.last_processed_block;
        logger.info("event_poller_start", { source: "cursor", resumeFrom: this.lastProcessedBlock + 1 });
        return;
      }
    } catch {
      // no cursor file yet (first boot) or unreadable — fall through
    }
    const head = await provider.getBlockNumber();
    this.lastProcessedBlock = Math.max(head - DEFAULT_BACKFILL_BLOCKS - 1, -1);
    logger.info("event_poller_start", {
      source: "head_minus_backfill",
      startBlock: this.lastProcessedBlock + 1,
      head,
    });
  }

  private async persistCursor(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(cursorFile()), { recursive: true });
      await fs.writeFile(
        cursorFile(),
        JSON.stringify({ chain_id: env.CHAIN_ID, last_processed_block: this.lastProcessedBlock }, null, 2),
        "utf-8",
      );
    } catch (err) {
      // A failed cursor write must never take the poller down; the worst case
      // is a slightly longer replay after the next restart.
      logger.warn("event_poller_cursor_write_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  onTaskCreated(handler: Handler<TaskCreatedEvent>): this {
    this.sources.push(
      makeSource(
        "TaskCreated",
        (log) => ({
          taskId: log.args.taskId as bigint,
          requester: log.args.requester as string,
          agent: log.args.agent as string,
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          logIndex: log.index,
        }),
        handler,
      ) as EventSource<unknown>,
    );
    return this;
  }

  // Shared dedup + handler dispatch for one event log. Both the WS live stream
  // and the HTTP poll backfill feed through here so an event is handled exactly
  // once regardless of which path (or both) delivered it. Dedup is applied
  // synchronously before the handler runs, so even fire-and-forget WS calls
  // can't double-handle.
  private dispatch(sourceIndex: number, source: EventSource<unknown>, eventLog: EventLog): Promise<void> {
    const key = `${sourceIndex}:${eventLog.transactionHash}:${eventLog.index}`;
    if (this.processedKeys.has(key)) return Promise.resolve();
    this.processedKeys.set(key, eventLog.blockNumber);

    // In WS mode tick() never runs, so its end-of-tick prune never fires;
    // prune here (throttled) to keep the dedup map bounded on mainnet.
    if (eventLog.blockNumber >= this.nextPruneBlock) {
      this.nextPruneBlock = eventLog.blockNumber + PRUNE_INTERVAL_BLOCKS;
      const pruneBefore = eventLog.blockNumber - DEDUP_RETENTION_BLOCKS;
      for (const [k, blockNumber] of this.processedKeys) {
        if (blockNumber < pruneBefore) this.processedKeys.delete(k);
      }
    }

    return Promise.resolve()
      .then(() => source.handler(source.parse(eventLog)))
      .catch((err: unknown) => {
        logger.error("event_handler_failed", {
          filter: source.filterName,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  // Live event ingestion over WebSocket (eth_subscribe). Required on mainnet
  // (chain 677), where the public HTTP RPC disables eth_getLogs. One filter per
  // source; ethers re-subscribes on reconnect. There is no historical backfill
  // in WS mode — the chain offers no eth_getLogs to replay from, so a cold boot
  // only sees events that land after the subscription is live.
  private subscribe(): void {
    const ws = wsProvider;
    if (!ws) return;
    logger.info("event_poller_ws_subscribing", {
      url: env.WSS_RPC_URL,
      filters: this.sources.map((s) => s.filterName),
    });
    this.sources.forEach((source, index) => {
      const fragment = contractInterface.getEvent(source.filterName);
      if (!fragment) {
        logger.warn("event_poller_ws_missing_event", { event: source.filterName });
        return;
      }
      const filter: EventFilter = { address: env.CONTRACT_ADDRESS, topics: [fragment.topicHash] };
      const listener = (log: Log): void => {
        void this.dispatch(index, source, log as EventLog);
      };
      this.wsSubscriptions.push({ filter, listener });
      void ws.on(filter, listener);
    });
    ws.on("error", this.onWsError);
  }

  private readonly onWsError = (err: unknown): void => {
    // A dropped socket must never take the oracle down: log it and let ethers'
    // reconnect (and the next event) recover. Never throws.
    logger.warn("event_poller_ws_error", { error: err instanceof Error ? err.message : String(err) });
  };

  start(): void {
    // WS mode (WSS_RPC_URL set): live events arrive via eth_subscribe — the only
    // log path mainnet exposes. Skip the HTTP poll loop entirely: its
    // queryFilter (eth_getLogs) is disabled on mainnet and would only error.
    if (wsProvider) {
      this.subscribe();
      return;
    }
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
    if (wsProvider) {
      for (const sub of this.wsSubscriptions) void wsProvider.off(sub.filter, sub.listener);
      void wsProvider.off("error", this.onWsError);
    }
    this.wsSubscriptions.length = 0;
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
      if (!this.cursorResolved) {
        this.cursorResolved = true;
        await this.resolveCursor();
      }
      const latestBlock = await provider.getBlockNumber();
      let windowStart = this.lastProcessedBlock + 1;
      if (windowStart > latestBlock) return;

      while (windowStart <= latestBlock) {
        const windowEnd = Math.min(windowStart + MAX_BLOCK_RANGE - 1, latestBlock);

        const results = await Promise.all(
          this.sources.map((source) => rawContract.queryFilter(source.filterName, windowStart, windowEnd)),
        );

        const handlerTasks: Promise<void>[] = [];
        for (let i = 0; i < this.sources.length; i++) {
          const source = this.sources[i]!;
          for (const log of results[i]!) {
            handlerTasks.push(this.dispatch(i, source, log as EventLog));
          }
        }
        await Promise.all(handlerTasks);

        this.lastProcessedBlock = windowEnd;
        windowStart = windowEnd + 1;
      }

      // Persisted after every tick that made progress: a restart then resumes
      // from this block instead of re-deriving history. The processedKeys map
      // stays an in-process dedup backstop only.
      await this.persistCursor();

      const pruneBefore = this.lastProcessedBlock - DEDUP_RETENTION_BLOCKS;
      for (const [key, blockNumber] of this.processedKeys) {
        if (blockNumber < pruneBefore) this.processedKeys.delete(key);
      }
    } finally {
      this.polling = false;
    }
  }
}
