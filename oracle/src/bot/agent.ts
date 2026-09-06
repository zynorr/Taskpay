import { readFile } from "node:fs/promises";
import path from "node:path";
import { Contract, Interface, Wallet, getBytes, keccak256, toUtf8Bytes } from "ethers";
import Groq from "groq-sdk";
import { env } from "../config/env.js";
import { provider, Status, type TaskStruct } from "../contract/client.js";
import { buildQuote, sendUserOp } from "../bundler/userop.js";
import { logger } from "../lib/logger.js";
import { withTimeout } from "../lib/concurrency.js";
import abi from "../contract/TaskPay.abi.json" with { type: "json" };

/**
 * Autonomous TaskPay agent (the "agent bot").
 *
 * The oracle can also run a self-operating worker. With AGENT_BOT_PRIVATE_KEY
 * set, a daemon adopts that wallet as its TaskPay identity (the SimpleAccount
 * the factory derives for it, salt 0) and each poll tick:
 *
 *   1. Lists every task where that account is the designated agent
 *      (getTasksFor — the same view the frontend uses).
 *   2. Created + accept window open → accepts, unless the archived spec is
 *      outside the bot's declared profile (then it declines and stays out).
 *   3. Accepted → reads the archived spec, generates a real deliverable with
 *      Groq, and submits it.
 *
 * Every action goes through the same sponsored gasless path as the UI
 * (buildQuote + sendUserOp), so the bot pays no gas and the paymaster covers
 * the ops. The bot is a distinct on-chain identity from the oracle operator.
 *
 * The spec is read from the shared archive (data/specs/<chainId>/<taskId>.json,
 * written by the frontend at create time) — the same side channel the
 * requester's UI uses to display "what the agent was asked". The archive is
 * only trusted once its text hashes to the task's on-chain specHash anchor:
 * a forged or stale row must never send the bot to work on the wrong task.
 *
 * Robustness rules (mirroring the event pipeline's principles):
 *   - One failing task never aborts the batch: each task is handled inside
 *     its own guard and logged with its taskId.
 *   - On-chain state is the only source of truth: after an op reverts, the
 *     bot re-reads the task; if the transition already happened on-chain
 *     (restart mid-flight, a race, a manual call), it records the outcome as
 *     a no-op instead of erroring.
 */

// The oracle's shared ABI JSON is trimmed to the methods the dispute pipeline
// calls; the bot additionally needs the task-listing/accept/submit surface, so
// it merges just those fragments in locally instead of widening the shared ABI.
const BOT_ABI = [
  "function getTasksFor(address party) view returns (uint256[] ids)",
  "function getOpenTasks() view returns (uint256[] openIds)",
  "function minRatingOf(uint256 taskId) view returns (uint256)",
  "function getAgentRatingSummary(address agent) view returns (uint256 totalScore, uint256 count)",
  "function acceptTask(uint256 taskId)",
  "function submitWork(uint256 taskId, string submission)",
] as const;

// Reads the bot needs. Typed explicitly (like client.ts does for its surface)
// because ethers' inferred typing on a spread ABI marks methods as possibly
// undefined.
interface BotContractSurface {
  getTasksFor(party: string): Promise<bigint[]>;
  getOpenTasks(): Promise<bigint[]>;
  getTask(taskId: bigint | number): Promise<TaskStruct>;
  minRatingOf(taskId: bigint | number): Promise<bigint>;
  getAgentRatingSummary(agent: string): Promise<[bigint, bigint]>;
}

const PROFILE_KEYWORDS = [
  "code", "script", "program", "implement", "build", "write", "generate",
  "create", "function", "class", "api", "endpoint", "contract", "solidity",
  "web3", "smart contract", "dapp", "frontend", "backend", "typescript",
  "javascript", "python", "rust", "go ", "bot", "fix", "refactor", "test",
  "debug", "documentation", "readme", "analyze", "research", "report",
] as const;

const MAX_DELIVERABLE_CHARS = 2_000;

// A hung RPC (the public testnet endpoint can stall for minutes) must not
// wedge the daemon: if a tick doesn't finish in this long, `busy` is reset
// and the next tick runs. Long enough for slow Groq calls + a sponsored op.
const TICK_TIMEOUT_MS = 60_000;

interface AgentOpResult {
  txHash: string;
}

interface ArchivedSpec {
  text: string; // trimmed spec text, as stored by the frontend
  hash: string; // spec_hash row field (frontend-computed), may be ""
}

export class AgentBot {
  private readonly owner: Wallet;
  private readonly groq = new Groq({ apiKey: env.GROQ_API_KEY });
  private readonly model: string;
  private readonly pollMs: number;

  // The account that IS the bot on TaskPay (factory-derived SimpleAccount).
  private account: string | null = null;

  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly declined = new Set<string>();
  private readonly submitted = new Set<string>();
  private readonly claimTried = new Set<string>();

  private readonly taskpay = new Contract(
    env.CONTRACT_ADDRESS,
    [...abi, ...BOT_ABI],
    provider,
  ) as unknown as BotContractSurface;
  private readonly iface = new Interface([...abi, ...BOT_ABI]);

  constructor() {
    this.owner = new Wallet(env.AGENT_BOT_PRIVATE_KEY!);
    this.model = env.AGENT_BOT_MODEL || "openai/gpt-oss-120b";
    this.pollMs = (env.AGENT_BOT_POLL_SECONDS ?? 12) * 1000;
  }

  async start(): Promise<void> {
    if (!env.AA_FACTORY || !env.PAYMASTER) {
      logger.warn("agent_bot_disabled", {
        reason: "AA_FACTORY/PAYMASTER not configured — the bot needs the sponsor stack to act gaslessly",
      });
      return;
    }
    // Resolve the identity once: counterfactual SimpleAccount for salt 0 (the
    // canonical account, same derivation the frontend uses for every user).
    const quote = await buildQuote({
      owner: this.owner.address,
      target: env.CONTRACT_ADDRESS,
      callData: "0x",
    });
    this.account = quote.sender;
    logger.info("agent_bot_identity", {
      name: env.AGENT_BOT_NAME,
      owner: this.owner.address,
      account: this.account,
      deployed: quote.isDeployed,
      profile: env.AGENT_BOT_ACCEPT_ALL
        ? "accept-all (AGENT_BOT_ACCEPT_ALL=true)"
        : `keyword profile (${PROFILE_KEYWORDS.length} terms)`,
    });
    logger.info("agent_bot_starting", {
      pollSeconds: env.AGENT_BOT_POLL_SECONDS ?? 12,
      // Designate this address as the agent on /create to have the bot do the work.
      hint: "create tasks with agent = " + this.account,
    });
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy || !this.account) return;
    this.busy = true;
    try {
      // Timeout-guarded: a stalled RPC call must skip a tick, not wedge the
      // daemon forever (the previous guard left `busy = true` permanently on
      // a hung provider call, silently stopping all future ticks). The stale
      // promise may still settle later, but every step re-reads on-chain
      // state and accept/submit are idempotent, so a late outcome can never
      // be applied twice.
      await withTimeout(this.doTick(), TICK_TIMEOUT_MS, "agent_bot_tick");
    } catch (err) {
      logger.error("agent_bot_tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.busy = false;
    }
  }

  private async doTick(): Promise<void> {
    // Designated work: tasks that already name the bot's account. ethers v6
    // freezes returned Result arrays, so copy into a mutable array before
    // merging the open pool below (pushing into the frozen result throws).
    const ids: bigint[] = [...(await this.taskpay.getTasksFor(this.account!))];
    // Open pool: first-come-first-served tasks (agent unset) — these never
    // appear in getTasksFor because the bot is not their agent yet.
    let openIds: bigint[] = [];
    try {
      openIds = [...(await this.taskpay.getOpenTasks())];
    } catch {
      // Contract without getOpenTasks (pre-v2 deploy) — designated-only mode.
    }
    const seen = new Set<string>(ids.map(String));
    for (const id of openIds) {
      if (!seen.has(id.toString())) ids.push(id);
    }
    for (const id of ids) {
      // Per-task isolation: a failing task (Groq outage, an on-chain revert
      // race, a spec mismatch) is logged with its taskId and the next task
      // is processed — one task must never break the batch.
      try {
        const task = (await this.taskpay.getTask(id)) as unknown as TaskStruct;
        if (Number(task.status) === Status.Created) {
          await this.handleCreated(id, task);
        } else if (Number(task.status) === Status.Accepted && task.agent.toLowerCase() === this.account!.toLowerCase()) {
          await this.handleAccepted(id, task);
        }
      } catch (err) {
        logger.error("agent_bot_task_failed", {
          taskId: id.toString(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Instant-reaction hook for TaskCreated events (wired by index.ts). Open
   * tasks (agent = 0x0) are evaluated and claimed immediately instead of
   * waiting for the next poll tick — first come, first served favors the
   * fastest listener. Designated tasks are ignored (the requester named
   * someone else; their bot/agent will see it via getTasksFor).
   */
  async notifyTaskCreated(taskId: bigint, agent: string): Promise<void> {
    if (!this.account || agent !== "0x0000000000000000000000000000000000000000") return;
    const key = taskId.toString();
    if (this.claimTried.has(key) || this.declined.has(key)) return;
    this.claimTried.add(key);
    try {
      const task = (await this.taskpay.getTask(taskId)) as unknown as TaskStruct;
      // Re-read live state: the event may be stale or the task already claimed.
      if (Number(task.status) !== Status.Created || task.agent !== "0x0000000000000000000000000000000000000000") return;
      await this.handleCreated(taskId, task);
    } catch (err) {
      logger.warn("agent_bot_event_claim_failed", {
        taskId: key,
        error: err instanceof Error ? err.message : String(err),
      });
      this.claimTried.delete(key); // allow the poll fallback to retry
    }
  }

  private async handleCreated(id: bigint, task: TaskStruct): Promise<void> {
    const key = id.toString();
    if (this.declined.has(key)) return;
    if (task.acceptDeadline <= BigInt(Math.floor(Date.now() / 1000))) {
      return; // window closed; the requester can reclaim — nothing for the bot to do
    }

    const spec = await this.readSpec(id);
    if (spec === null) return; // spec not archived yet — retry next tick

    // Trust the archive only when it matches the on-chain anchor. The
    // frontend hashes the trimmed spec text (keccak of UTF-8 bytes), so the
    // bot verifies with the same convention before doing any work.
    const recomputed = keccak256(toUtf8Bytes(spec.text));
    if (recomputed !== task.specHash.toLowerCase()) {
      this.declined.add(key);
      logger.warn("agent_bot_spec_mismatch", {
        taskId: key,
        onChainSpecHash: task.specHash,
        archivedSpecHash: recomputed,
        archiveRowHash: spec.hash || null,
        specSnippet: spec.text.slice(0, 120),
      });
      return;
    }

    if (!env.AGENT_BOT_ACCEPT_ALL && !PROFILE_KEYWORDS.some((k) => spec.text.toLowerCase().includes(k))) {
      this.declined.add(key);
      logger.info("agent_bot_declined", {
        taskId: key,
        reason: "does not match the bot's profile",
        specSnippet: spec.text.slice(0, 120),
      });
      return;
    }

    // Open-task reputation floor (v3): a task with minRating > 0 only accepts
    // claimers whose floored on-chain average clears it. Checked BEFORE the
    // claim so the bot never burns a sponsored op on a guaranteed revert.
    // Deliberately NOT sticky (unlike profile mismatches): the floor is
    // re-evaluated each tick, so newly earned ratings unlock still-open work.
    if (!(await this.meetsRatingFloor(id))) {
      logger.info("agent_bot_rating_floor_blocked", { taskId: key, minRating: await this.minRating(id) });
      return;
    }

    try {
      const res = await this.op("acceptTask", [id]);
      logger.info("agent_bot_accepted", { taskId: key, txHash: res.txHash });
    } catch (err) {
      // Benign race: a previous tick's accept (or a manual call from the
      // owner wallet) confirmed between our status read and this send.
      // On-chain state is the truth — if it's no longer Created, nothing
      // left to do.
      const live = (await this.taskpay.getTask(id)) as unknown as TaskStruct;
      if (Number(live.status) !== Status.Created) {
        logger.info("agent_bot_accept_noop", {
          taskId: key,
          status: Number(live.status),
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      throw err; // genuine failure — the per-task guard logs it
    }
  }

  private async handleAccepted(id: bigint, task: TaskStruct): Promise<void> {
    const key = id.toString();
    if (this.submitted.has(key)) return;
    if (task.workDeadline <= BigInt(Math.floor(Date.now() / 1000))) {
      return; // expired — requester refunds; nothing to submit
    }

    const spec = await this.readSpec(id);
    if (spec === null) return; // spec not archived yet — retry next tick

    const deliverable = await this.generateDeliverable(spec.text);
    try {
      const res = await this.op("submitWork", [id, deliverable]);
      this.submitted.add(key);
      logger.info("agent_bot_submitted", {
        taskId: key,
        txHash: res.txHash,
        chars: deliverable.length,
      });
    } catch (err) {
      // Benign restart/race: the task already left Accepted (e.g. a previous
      // tick's submit landed after our status read, or a restart lost the
      // in-memory `submitted` set). Record it as done — on-chain state is
      // the source of truth.
      const live = (await this.taskpay.getTask(id)) as unknown as TaskStruct;
      if (Number(live.status) !== Status.Accepted) {
        this.submitted.add(key);
        logger.info("agent_bot_submit_noop", {
          taskId: key,
          status: Number(live.status),
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      throw err; // genuine failure — the per-task guard logs it
    }
  }

  /** The task's open-task reputation floor (0 = none). Pre-v3 contracts have no floor. */
  private async minRating(id: bigint): Promise<number> {
    try {
      return Number(await this.taskpay.minRatingOf(id));
    } catch {
      return 0;
    }
  }

  /** Whether the bot's own on-chain rating clears the task's floor. */
  private async meetsRatingFloor(id: bigint): Promise<boolean> {
    const minRating = await this.minRating(id);
    if (minRating === 0) return true;
    try {
      const [totalScore, count] = await this.taskpay.getAgentRatingSummary(this.account!);
      if (count === 0n) return false; // unrated agents fail any floor >= 1
      return totalScore / count >= BigInt(minRating);
    } catch {
      return true; // summary read failed — let the chain decide via the claim
    }
  }

  /** The requester's archived spec (data/specs/<chainId>/<taskId>.json). */
  private async readSpec(id: bigint): Promise<ArchivedSpec | null> {
    try {
      const raw = await readFile(
        path.join(env.DATA_DIR, "specs", String(env.CHAIN_ID), `${id.toString()}.json`),
        "utf-8",
      );
      const row = JSON.parse(raw) as { spec_text?: string; spec_hash?: string };
      const text = row.spec_text?.trim() || null;
      if (text === null) return null;
      return { text, hash: row.spec_hash ?? "" };
    } catch {
      return null;
    }
  }

  /** Ask Groq to actually produce the deliverable for the spec. */
  private async generateDeliverable(specText: string): Promise<string> {
    logger.info("agent_bot_generating", { model: this.model, specSnippet: specText.slice(0, 120) });
    const response = await this.groq.chat.completions.create({
      model: this.model,
      // Generous ceiling: at 900 tokens gpt-oss-120b repeatedly hit
      // finish_reason="length" mid-code. The 2,000-char guard below still caps
      // what actually lands on-chain, so a high token budget only guarantees
      // the model FINISHES — it does not bloat the stored submission.
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            `You are ${env.AGENT_BOT_NAME}, an autonomous agent working on TaskPay. ` +
            "Produce the actual deliverable a contractor would hand in for the task below " +
            "(working code, a document, an artifact — whatever the task asks for). " +
            "Output ONLY the deliverable itself: no commentary, no headings about what you did, " +
            "no fenced wrapper. Keep it under ~1500 characters.",
        },
        { role: "user", content: `TASK:\n${specText}` },
      ],
    });

    const choice = response.choices[0];
    if (choice?.finish_reason === "length") {
      throw new Error("Groq cut the deliverable off at max_tokens — refusing to submit a truncated artifact");
    }
    const out = (choice?.message.content ?? "").trim();
    if (!out) {
      throw new Error("Groq returned an empty deliverable");
    }
    return out.length > MAX_DELIVERABLE_CHARS
      ? `${out.slice(0, MAX_DELIVERABLE_CHARS)}\n…(truncated at ${MAX_DELIVERABLE_CHARS} chars)`
      : out;
  }

  /**
   * Run one TaskPay method as the bot's SimpleAccount, sponsored by the
   * paymaster: buildQuote (fills nonce/gas/paymaster, computes userOpHash) →
   * sign with the bot EOA → sendUserOp (simulates, then broadcasts handleOps
   * under the shared oracle-wallet tx lock).
   */
  private async op(functionName: string, args: unknown[]): Promise<AgentOpResult> {
    const callData = this.iface.encodeFunctionData(functionName, args);
    const quote = await buildQuote({
      owner: this.owner.address,
      target: env.CONTRACT_ADDRESS,
      callData,
    });
    quote.userOp.signature = await this.owner.signMessage(getBytes(quote.userOpHash));
    return sendUserOp(quote.userOp);
  }
}