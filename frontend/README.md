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
- `/create` — task name + requirements, friendly duration presets, quick
  escrow chips, inline validation, and automatic spec registration
  (name + hashed spec text)
- `/task/[id]` — lifecycle timeline, status-relevant deadlines with urgency
  coloring, on-chain AI verdicts (Reviewer / Fraud-Sanity / Senior Arbiter),
  expandable archived reasoning, agent rating summary, and role-aware actions
  (accept / submit / release / dispute / resolve / challenge / rate)

All addresses, hashes, and transaction confirmations link out to BOT Scan
(`scan.bohr.life`) with one-click copy.

## API routes

- `/api/reasoning/[taskId]` — the oracle's archived AI reasoning rows for a task
- `/api/specs/[taskId]` — GET one task's registered spec (name + text); POST
  registers it. The create flow calls POST automatically after creating a task,
  so the marketplace, detail page, and dispute agents can read what was asked
- `/api/specs` — batch GET of every registered spec, keyed by task id; the
  marketplace uses this to render each card's name + summary in one request

Both read/write `taskpay/data/` (the oracle's file archive; `TASKPAY_DATA_DIR`
overrides the path, `NEXT_PUBLIC_CHAIN_ID` the chain subdir).

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_TASKPAY_CONTRACT` | `0x7E1596…90c5` (testnet deploy) | contract to read/write |
| `NEXT_PUBLIC_CHAIN_ID` | `968` | chain subdir for the API routes |
| `NEXT_PUBLIC_BUNDLER_URL` | unset | oracle sponsor-bundler base URL — **required**: task creation + actions are gasless-only |
| `NEXT_PUBLIC_AA_FACTORY` | canonical testnet deploy | SimpleAccountFactory |
| `NEXT_PUBLIC_PAYMASTER` | canonical testnet deploy | VerifyingPaymaster |
| `NEXT_PUBLIC_ENTRY_POINT` | canonical v0.7 | EntryPoint |

## Gasless-only writes (ERC-4337)

The UI **never broadcasts a transaction from the user's wallet**. Every write
is a sponsored UserOp executed by the user's **SimpleAccount** (derived from
their connected EOA + salt 0) through the oracle's sponsor bundler: the
wallet only signs one UserOp hash and the paymaster covers gas. Because
`msg.sender` is the account, a task's on-chain roles are the participants'
TaskPay accounts (not raw wallets).

For **creating** a task, the escrow must sit in the requester's TaskPay
account first. The form shows the account address + live balance; when it's
short of the escrow it displays the exact amount to send and watches for the
deposit automatically. The transfer itself happens in the user's own wallet
on chain 968 — TaskPay never signs a funding transaction. A wrong-network
guard banner auto-switches the wallet to BOT Chain testnet and offers a manual
retry, and legacy tasks bound to a raw EOA are flagged as not actionable from
the gasless-only app.

Wallet: wagmi `injected` connector (MetaMask / any `window.ethereum` wallet on
BOT Chain). Add the network in your wallet:

- RPC `https://rpc.bohr.life`, chain id `968`, symbol `BOT`, explorer
  `https://scan.bohr.life` (testnet tBOT from the faucet).