# TaskPay

**Settlement, dispute resolution, and reputation for agent work on BOT Chain.**

TaskPay lets a human or autonomous requester lock BOT for a designated agent,
have the agent accept and submit a deliverable, and settle payment on-chain —
through requester approval, a worker-friendly expiry default, or, when
disputed, an AI-agent quorum with a human Senior Arbiter override. Every
settled task leaves a portable on-chain reputation trail for the agent.

Positioned for the BOT Chain Ecosystem Support Program (Option C — user
growth, interactions, and TVL from a pre-token application).

## Why

BOT Chain is shipping agent infrastructure — on-chain identity, dedicated
agent wallets, native on-chain interaction — but has no settlement, dispute,
or reputation layer on top of it. Agent work needs the same three things
freelance markets standardized years ago: escrowed payment, a fair dispute
path, and a reputation record that follows the worker. TaskPay is that layer:
one contract holding the escrow, an optional off-chain oracle that runs AI
agents only when a dispute is raised, and on-chain reputation that any
downstream application can read.

## Design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Judge | **Requester-first; AI only on dispute** | The requester approves or disputes within a review window. The AI quorum only runs when a dispute is raised, so normal tasks cost zero oracle fees |
| Silent requester | **Auto-finalize pays the agent** after the review period | Requester silence becomes an action; the agent is never left unpaid by inaction |
| Acceptance | Designated agent + **accept window** | Prevents accept-after-reclaim races |
| Consensus | **2-of-3 AI quorum** (Reviewer / FraudSanity / Arbiter; Arbiter only on split) | No single model output moves funds; reasoning hashes are anchored on-chain |
| Escalation | **Challenge window → human Senior Arbiter**, binding, with timeout fallback to the tentative outcome | Deterministic dispute path; funds can never be stranded by an unresponsive oracle |
| Oracle | Single updatable address (later: committee/DVN) | Centralized v1 with an explicit decentralization roadmap |
| Stuck funds | `refundAfterStalledDispute` once the review period lapses without consensus | The requester can always exit a stalled dispute |
| Fees | Optional platform fee (default 0, max 5%) charged **only on worker payout**, accruing to a treasury | Sustainable without touching refunds |
| Reputation | 1–5 ratings + released-task count per agent, one per task | Portable on-chain reputation is the retention moat |

## Contract architecture

Single self-contained contract (`src/TaskPay.sol`) holding escrowed BOT —
no external token flow.

**Statuses**

```
Created → Accepted → Submitted → Released          (requester approves)
Created → Cancelled / Refunded                     (missed accept window, mutual cancel)
Submitted → Released                               (finalizeAfterReview — silence pays agent)
Submitted → Disputed → PendingChallenge → Released | Refunded
             └─ refundAfterStalledDispute → Refunded   (no consensus before review lapse)
PendingChallenge → Challenged → Released | Refunded    (Senior Arbiter, binding)
PendingChallenge → Released | Refunded                 (unchallenged, after window)
Challenged → Released | Refunded                       (arbiter timeout → tentative outcome)
```

**Core functions**

| Group | Functions |
|---|---|
| Lifecycle | `createTask(agent, specHash, acceptWindow, workDuration, reviewPeriod)` (payable), `acceptTask`, `submitWork(submission)` |
| Settlement | `release`, `finalizeAfterReview` (anyone), `refundExpiredTask`, `reclaimAfterDeadline`, `cancelOpenTask`, `setCancellationApproval` (mutual) |
| Dispute | `raiseDispute(reason)`, `submitVerdict(role, approved, reasoningHash)` (oracle), `resolveDispute` (2-of-3 → tentative + challenge window), `challenge` (losing party only), `finalizeAfterChallenge`, `submitSeniorArbiterVerdict` (oracle, binding), `resolveAfterSeniorArbiterTimeout`, `refundAfterStalledDispute` |
| Reputation | `rateAgent(taskId, 1..5)`, `getAgentRatingSummary`, `getAgentTaskCount` |
| Admin | `setOracle`, `setChallengeWindow`, `setSeniorArbiterWindow`, `setFee`, `withdrawTreasury` (all owner) |
| Views | `getTask`, `getVerdict`, `getDispute`, `getTasksFor(address)` |

**Security posture:** ReentrancyGuard on every fund-moving path;
state-before-transfer ordering; role checks on every actor boundary;
deliverable evidence verified off-chain before AI review (server-side commit
check); every deadline/expiry path is public and callable by anyone, so the
oracle is never a gatekeeper; fees charged only on success; terminal-status
transitions covered by tests including a malicious-receiver case.

## Repo layout

```
taskpay/
├── foundry.toml            # via_ir, solc 0.8.24, remappings
├── .gitignore
├── .env.example            # deployment + oracle env template
├── src/
│   └── TaskPay.sol         # the settlement contract (self-contained)
├── test/
│   ├── TaskPay.t.sol           # 76 unit tests (lifecycle/settlement/dispute/fees/reputation)
│   ├── TaskPayFuzz.t.sol       # 8 fuzz tests (amounts, vote combos, window boundaries)
│   ├── TaskPayInvariant.t.sol  # accounting + ghost-counter invariants
│   └── handlers/
│       └── TaskPayHandler.sol  # bounded random-action handler for invariants
├── oracle/                  # off-chain AI agent service (see oracle/README.md)
├── frontend/                # Next.js app: task marketplace + dispute explorer
│   ├── app/                 #   pages (/, /create, /task/[id]) + /api routes
│   │   └── api/             #   /api/reasoning, /api/specs — serve the oracle archive
│   ├── components/          #   connect button, task card, role-aware action panel
│   └── lib/                 #   wagmi config, chains, typed contract reads/writes
├── script/Deploy.s.sol      # env-driven deploy script
└── DEPLOY.md                # testnet (968) + mainnet (677) deployment guide
```

## Build & test

```bash
cd taskpay
forge build          # compiles TaskPay.sol + OZ deps (via_ir)
forge test           # 85 tests: 76 unit + 8 fuzz + 1 invariant (~3 min)
forge test --match-path test/TaskPay.t.sol   # fast loop (unit only)
forge test --profile ci                      # fuzz 256 / invariant 1024 depth
```

Requires [Foundry](https://getfoundry.sh). Dependencies:
`forge-std`, `openzeppelin-contracts@v5.0.2`.

## Roadmap

| Phase | Scope | Deliverable |
|---|---|---|
| 1 (done) | Core contract + tests | `TaskPay.sol`, 85 tests passing |
| 2 (done) | Oracle service | TS event poller + Reviewer/FraudSanity/Arbiter/Senior Arbiter agents (`oracle/`, typecheck + build clean); live-tested on testnet with Groq |
| 3 (done) | Frontend | Next.js + wagmi/viem (injected connector) on testnet 968: task marketplace, create/actions, dispute explorer with archived AI reasoning (`frontend/`, typecheck + build clean) |
| 4 (done) | Gasless UX | ERC-4337 v0.7 sponsored UserOps: canonical EntryPoint verified live on BOT Chain, own `SimpleAccountFactory` + `VerifyingPaymaster` deployed, oracle doubles as the sponsor bundler (`/v1/quote` + `/v1/send`); users act through their SimpleAccount and pay 0 gas. Live-tested end-to-end (create → accept → submit → release) |
| 5 | Launchpad integration | Agent identity ↔ reputation registry once BOT Chain's AI Agent Launchpad ships |
| 6 | Mainnet + fund tracking | Deploy on 677, instrument Option C metrics (valid users / interactions / TVL) |

## ERC-4337 sponsor stack (Phase 4)

BOT Chain has no production 4337 infrastructure (bundler RPC / paymaster), but the
canonical **EntryPoint v0.7** is deployed at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
— verified byte-identical to the mainnet deployment. TaskPay runs its own minimal
sponsor stack on top of it:

| Contract | Address (testnet 968) | Notes |
|---|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | canonical, pre-deployed |
| SimpleAccountFactory | `0xFbfBBD060b1d4E7Edae6D9e58C73F731927b2f2b` | counterfactual accounts (owner EOA + salt 0) |
| VerifyingPaymaster | `0x8Ed5e3054A98a6528B666Ca99411648B94A0fDF0` | sponsors gas; signer = oracle key; deposit funded in EntryPoint |

Contracts are vendored from `@account-abstraction/contracts@0.7.0` under `src/aa/`
(see `script/DeployAA.s.sol`). Those files keep their upstream GPL-3.0 SPDX
headers; the rest of the repo (TaskPay.sol, oracle, frontend) is MIT. The **oracle service is the bundler**: it exposes
`POST /v1/quote` (builds the UserOp, attaches the paymaster signature, returns the
hash to sign) and `POST /v1/send` (simulates with `eth_call`, then broadcasts
`handleOps` from the oracle EOA; gas settles from the paymaster deposit). The
frontend signs the UserOp hash with the user's EOA and the whole action executes
gasless. Roles on-chain become the user's **smart account** (each connected EOA's
`SimpleAccount`), so identity and gasless UX are the same mechanism.

Verify locally (requires a funded `.env`):

```bash
cd oracle && npm run build && cd ..
node scripts/live_gasless.mjs        # module-level: create→accept→submit→release, all sponsored
node scripts/gasless_http_e2e.mjs    # HTTP-level, exactly what the frontend does
```

## License

MIT
