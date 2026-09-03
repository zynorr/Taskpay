# TaskPay frontend

Next.js (App Router) + wagmi/viem UI for TaskPay on BOT Chain testnet (968).
Reads the live contract, drives lifecycle/dispute actions from the connected
wallet, and renders the oracle's archived AI reasoning via local API routes.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Production: `npm run build && npm start`.

## Pages

- `/` — marketplace with hero, live stats (tasks / escrow volume / disputes /
  settled), status filter tabs (all / active / disputed / settled / mine),
  auto-refresh every 8s, and connection-aware "your requester/agent" chips
- `/create` — fund a task with friendly duration presets, quick escrow chips,
  inline validation, a live preview, and automatic spec registration
- `/task/[id]` — lifecycle timeline, status-relevant deadlines with urgency
  coloring, on-chain AI verdicts (Reviewer / Fraud-Sanity / Senior Arbiter),
  expandable archived reasoning, agent rating summary, and role-aware actions
  (accept / submit / release / dispute / resolve / challenge / rate)

All addresses, hashes, and transaction confirmations link out to BOT Scan
(`scan.bohr.life`) with one-click copy.

## API routes

- `/api/reasoning/[taskId]` — the oracle's archived AI reasoning rows for a task
- `/api/specs/[taskId]` — GET the registered spec text for a task; POST registers
  it (the create flow calls POST automatically, so the detail page and the
  dispute agents can read what was asked)

Both read/write `taskpay/data/` (the oracle's file archive; `TASKPAY_DATA_DIR`
overrides the path, `NEXT_PUBLIC_CHAIN_ID` the chain subdir).

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_TASKPAY_CONTRACT` | `0x7E1596…90c5` (testnet deploy) | contract to read/write |
| `NEXT_PUBLIC_CHAIN_ID` | `968` | chain subdir for the API routes |
| `NEXT_PUBLIC_BUNDLER_URL` | unset | oracle sponsor-bundler base URL; when set, task creation + actions run **gasless** via ERC-4337 |
| `NEXT_PUBLIC_AA_FACTORY` | canonical testnet deploy | SimpleAccountFactory |
| `NEXT_PUBLIC_PAYMASTER` | canonical testnet deploy | VerifyingPaymaster |
| `NEXT_PUBLIC_ENTRY_POINT` | canonical v0.7 | EntryPoint |

## Gasless mode (ERC-4337)

With `NEXT_PUBLIC_BUNDLER_URL` set, the UI routes every write through the
user's **SimpleAccount** (derived from their connected EOA + salt 0). The
task's on-chain roles become smart-account addresses; action buttons detect
whether the requester/agent on a task is your EOA or your smart account and
use the right path. The wallet only signs one UserOp hash — the oracle's
paymaster covers the gas.

For **creating** a task gasless, the escrow must sit in the smart account
first: the form shows your smart account + balance and a one-click **Fund
account** button (a single normal deposit; every action afterwards is
sponsored). The agent side works the same way — the form can show the agent's
counterfactual smart account so they can also act gasless.

Wallet: wagmi `injected` connector (MetaMask / any `window.ethereum` wallet on
BOT Chain). Add the network in your wallet:

- RPC `https://rpc.bohr.life`, chain id `968`, symbol `BOT`, explorer
  `https://scan.bohr.life` (testnet tBOT from the faucet).