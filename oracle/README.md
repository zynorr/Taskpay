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

## Layout

```
oracle/
├── src/
│   ├── index.ts                # entry: poller + scan timer + health server
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
│   ├── github/fetch.ts         # repo-at-pinned-commit fetcher (size-capped, cached)
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
│       ├── logger.ts           # structured JSON logging
│       ├── txMutex.ts          # serializes oracle-wallet sends
│       └── concurrency.ts      # bounded mapWithConcurrency
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

## Deliverable evidence model

TaskPay's `submission` field is free-form. The oracle treats a submission as
repo evidence only when it looks like `https://github.com/owner/repo @ <sha>`
(or `url@sha`), and then fetches the repo **at the pinned commit** for the
agents (smallest-files-first under a 1MB cap, common generated/media paths
excluded, cached per `owner/repo@commit`). Any other submission is passed to
the agents verbatim as text evidence.

## Scope notes

- **Off-chain archives are file-backed** (`store/`). A hosted store (e.g.
  Supabase with RLS) replaces this when the frontend lands (roadmap phase 3).
- **Requester-only refund paths are not auto-called.** `reclaimAfterDeadline`,
  `refundExpiredTask`, `refundAfterStalledDispute` are reserved for the
  requester by the contract; the scan logs stalled disputes instead.
- **The Senior Arbiter challenge reason arrives as an on-chain hash.** TaskPay
  does not store free text on-chain; full challenge text is expected to be
  archived by the frontend before a challenge is escalated.
