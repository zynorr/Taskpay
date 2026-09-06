# TaskPay Oracle

The off-chain worker behind TaskPay's dispute-resolution. It listens to the
TaskPay contract, runs the AI agent roles when a dispute is raised, and
auto-triggers deadline-based transitions that need no human.

The oracle follows TaskPay's **judge-first** model: it stays quiet unless a
dispute is raised. The requester is the default judge; AI review only runs
when they contest the deliverable, so normal tasks cost zero oracle/AI fees.

## What it does

| Trigger | Action |
|---|---|
| `DisputeRaised(taskId)` event | Runs **Reviewer** + **FraudSanity** agents on the deliverable (in parallel); if they disagree, runs **Arbiter** to break the tie; submits each verdict on-chain; once 2-of-3 consensus exists, calls `resolveDispute` |
| `ChallengeRaised(taskId)` event | Runs the **Senior Arbiter** agent on the full dispute trail (spec, prior verdicts + reasoning, tentative outcome, challenge) and submits the **binding** verdict |
| Periodic scan (all tasks by ID) | Auto-calls permissionless expiry transitions: `finalizeAfterReview` (requester silent → agent paid), `finalizeAfterChallenge`, `resolveAfterSeniorArbiterTimeout`. Logs stalled disputes that need the requester's `refundAfterStalledDispute` |
| `POST /v1/quote` + `POST /v1/send` (same HTTP server) | **Sponsor bundler** (ERC-4337 v0.7): the oracle builds a sponsored UserOp for a user's SimpleAccount (`quote`), then simulates and broadcasts `handleOps` (`send`). The paymaster deposit in the EntryPoint covers gas, so users pay nothing |
| `AGENT_BOT_PRIVATE_KEY` set (daemon tick) | **Autonomous agent bot**: accepts tasks created for its smart account, verifies the archived spec against the on-chain `specHash`, generates a real deliverable with Groq, and submits it — every op sponsored by the same paymaster, so the bot pays no gas either |

## Operating principles

1. **On-chain state is the only source of truth.** No persisted poll cursor,
   no mirrored statuses: a restart replays from the start block in bounded
   chunks and re-derives everything live from the chain.
2. **Idempotent everywhere.** Before any submission, the submitter re-reads the
   live on-chain verdict; an existing matching verdict is a safe no-op, and an
   existing *mismatched* one (different hash or approval) fails loudly — it
   signals non-deterministic re-generation, never a silent retry.
3. **The oracle is a convenience, not a gatekeeper.** Every transition it
   triggers is a public contract function a human can call. If the oracle is
   down, funds still move — only slower.
4. **One wallet, one nonce.** Every send goes through a shared tx lock
   (`lib/txMutex.ts`) so the event-driven listener and the deadline scan can
   never collide on nonces.
5. **Never let one task break the batch.** Each event handler catches its own
   errors and is retried on a later tick; poller ticks chunk log queries and
   dedupe within the process lifetime.
6. **Reasoning is archived off-chain, hashed on-chain.** TaskPay anchors
   `keccak(reasoningText)` in the verdict; the full text is written under
   `data/reasoning/{chainId}/{taskId}.{role}.json` for the frontend to render.
7. **A hung RPC can only skip a cycle, never kill the daemon.** The bot tick
   and the deadline scan are timeout-guarded (`lib/concurrency.ts`
   `withTimeout`), so a stalled public-RPC call resets the `busy`/`scanning`
   guard and the next tick runs — it can never wedge the loop permanently.
8. **Logs are real-time.** The logger writes synchronously (`fs.writeSync`,
   not `console.*`) — redirected stdout buffers on some hosts (Windows), which
   made a healthy daemon look wedged and hid the last error of a stuck one.

## Layout

```
oracle/
├── src/
│   ├── index.ts                # entry: poller + scan timer + HTTP (health + bundler)
│   ├── config/env.ts           # validated env (fails loud at boot)
│   ├── contract/
│   │   ├── TaskPay.abi.json    # hand-maintained ABI (matches TaskPay.sol)
│   │   ├── client.ts           # provider/wallet/typed contract + Status/AgentRole
│   │   ├── types.ts            # minimal typed method surface
│   │   ├── reads.ts            # getTask/getVerdict/getDispute (typed views)
│   │   └── events.ts           # chunked, deduped event poller
│   ├── agents/                 # AI roles via Groq (forced submit_verdict tool call)
│   │   ├── base.ts             # shared call path + context formatting
│   │   ├── reviewer.ts         # spec-compliance judge
│   │   ├── fraudSanity.ts      # gaming/fake-submission filter
│   │   ├── arbiter.ts          # tie-break (only on Reviewer/Fraud split)
│   │   └── seniorArbiter.ts    # binding appeal authority
│   ├── bundler/                # ERC-4337 sponsor bundler
│   │   ├── userop.ts           # buildQuote/sendUserOp against the live EntryPoint
│   │   ├── routes.ts           # /v1/quote + /v1/send HTTP handlers
│   │   └── abi/                # EntryPoint/Factory/Paymaster/SimpleAccount ABIs
│   ├── github/fetch.ts         # repo-at-pinned-commit fetcher (size-capped, cached)
│   ├── bot/agent.ts            # autonomous worker persona (optional; see below)
│   ├── monitor/paymaster.ts    # EntryPoint deposit watcher (exposed on /health)
│   ├── pipeline/
│   │   ├── context.ts          # task → DeliverableContext (repo or plain text)
│   │   ├── handleDispute.ts    # quorum flow (Reviewer/Fraud/Arbiter → resolve)
│   │   ├── handleChallenge.ts  # Senior Arbiter flow
│   │   └── autoActions.ts      # permissionless deadline transitions + stall logs
│   ├── verdict/
│   │   ├── submit.ts           # idempotent verdict submission (tx-locked)
│   │   └── resolve.ts          # tx-locked resolveDispute
│   ├── store/                  # file-backed off-chain archive
│   │   ├── reasoning.ts        # verdict reasoning text
│   │   └── specs.ts            # task spec text keyed to on-chain specHash
│   └── lib/
│       ├── logger.ts           # real-time structured JSON logging (sync writes)
│       ├── txMutex.ts          # serializes oracle-wallet sends
│       └── concurrency.ts      # bounded mapWithConcurrency + withTimeout race helper
```

## Operation

```bash
# env lives at taskpay/.env (shared root, see .env.example at repo root)
cd taskpay/oracle
npm install
npm run dev                 # tsx watch (development)
npm run build && npm start  # production (node dist/index.js)
npm run typecheck
```

The AI agents run on **Groq** (OpenAI-compatible) — set `GROQ_API_KEY` in
taskpay/.env (default model `openai/gpt-oss-120b`, override with `GROQ_MODEL`).
Env validation fails loud at boot (see `config/env.ts`).

### Sponsor bundler (gasless actions)

The oracle doubles as TaskPay's ERC-4337 v0.7 bundler + paymaster signer. Set
in taskpay/.env (all optional — omit to run dispute-only):

```bash
ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032   # canonical v0.7 (live on BOT)
AA_FACTORY=0x...                                         # SimpleAccountFactory (see DeployAA.s.sol)
PAYMASTER=0x...                                          # VerifyingPaymaster; signer = oracle key
PORT=8787                                                # serves /v1/quote + /v1/send + health
```

The frontend points `NEXT_PUBLIC_BUNDLER_URL` at this port. Flow: frontend
builds a TaskPay call → `/v1/quote` returns a UserOp (paymaster-signed,
gas-filled) + the hash for the user's EOA to sign → the user signs (one wallet
popup, zero gas) → `/v1/send` simulates with `eth_call` and broadcasts
`handleOps` from the oracle EOA; the EntryPoint settles gas from the paymaster
deposit. See the gasless sections in the repo README and `scripts/live_gasless.mjs`
for a full worked lifecycle.

### Autonomous agent bot

Setting `AGENT_BOT_PRIVATE_KEY` in taskpay/.env makes the oracle also run a
self-operating worker (`src/bot/agent.ts`) — a distinct on-chain identity from
the oracle operator. Each poll tick it lists tasks where its factory-derived
SimpleAccount (salt 0) is the designated agent **plus every task in the open
pool** (`getOpenTasks`) — open tasks are also claimed the moment their
`TaskCreated` event lands in a polled block (`index.ts` wires the hook; the
tick is the fallback) — and for each candidate task:

1. **Created + accept window open** → it accepts, but only after verifying the
   archived spec text (`data/specs/<chainId>/<taskId>.json`) hashes to the
   task's on-chain `specHash` — a forged or stale archive row is declined, never
   worked on — after a keyword profile check (`AGENT_BOT_ACCEPT_ALL` bypasses
   the profile), and after pre-checking any `minRating` reputation floor on
   open tasks (v3) so it never spends a sponsored op on a guaranteed revert
   (the floor is re-evaluated each tick, not sticky, so newly earned ratings
   unlock still-open gated work).
2. **Accepted** → it reads the spec, generates a real deliverable with Groq, and
   submits it. Deliverables are capped at 2,000 chars because the submission
   text is stored on-chain (the bundler's gas headroom is sized for that), and
   a `max_tokens` cut-off is refused rather than submitted truncated.

Every action goes through the same sponsored gasless path as the UI
(`buildQuote` + `sendUserOp`), so the bot pays no gas. A failing task is logged
with its taskId and never aborts the rest of the batch, and accept/submit are
idempotent across restarts — after an on-chain revert the bot re-reads the
status and treats an already-transitioned task as a no-op.

Designate the bot's account as the **Agent** on `/create` to have it do the
work (`scripts/live_agent_bot.mjs` drives the full requester-side lifecycle
against it), or post an **open task** and let it race for the claim
(`scripts/live_open_task.mjs` posts one with a `minRating` floor and watches
the event hook win the race). Env knobs: `AGENT_BOT_NAME`,
`AGENT_BOT_POLL_SECONDS`, `AGENT_BOT_MODEL`, `AGENT_BOT_ACCEPT_ALL` — see
`.env.example`.

## Deliverable evidence model

TaskPay's `submission` field is free-form. The oracle treats a submission as
repo evidence only when it looks like `https://github.com/owner/repo @ <sha>`
(or `url@sha`), and then fetches the repo **at the pinned commit** for the
agents (smallest-files-first under a 1MB cap, common generated/media paths
excluded, cached per `owner/repo@commit`). Any other submission is passed to
the agents verbatim as text evidence.

## Scope notes

- **Off-chain archives are file-backed** (`store/`, shared `data/` directory).
  The frontend serves and writes the same archive over its `/api/reasoning` and
  `/api/specs` routes; a hosted store (e.g. Supabase with RLS) would replace
  the shared filesystem in a multi-node deployment.
- **Requester-only refund paths are not auto-called.** `reclaimAfterDeadline`,
  `refundExpiredTask`, `refundAfterStalledDispute` are reserved for the
  requester by the contract; the scan logs stalled disputes instead.
- **The Senior Arbiter challenge reason arrives as an on-chain hash.** TaskPay
  does not store free text on-chain; full challenge text is expected to be
  archived by the frontend before a challenge is escalated.
- **The bundler sponsors every UserOp it can simulate.** `eth_call` on
  `handleOps` is the gate: invalid signatures, unfunded escrow, or calls to
  other contracts revert in simulation and are never broadcast. Two extra
  guards apply after that gate: each op is built with generous execution-gas
  headroom (2M call gas — `submitWork` stores its text on-chain at ~22k gas
  per 32-byte word, and 250k silently ran out of gas), and after broadcasting,
  `sendUserOp` checks the EntryPoint's `UserOperationEvent.success` flag —
  v0.7 catches execution failures, so a tx that mines with status 1 can still
  hide a reverted inner call. The paymaster deposit is the only real cost
  ceiling — top it up via `paymaster.deposit{value: …}()` when low.
- **BOT Chain has base fee 0 and a fixed gas price**, so UserOps use legacy
  fee mode (equal max/priority fees) and `handleOps` is broadcast as a type-0
  tx. EntryPoint bytecode on 968 is byte-identical to mainnet's canonical
  v0.7 deployment (verified by code comparison).
