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

- `/` — task marketplace: every task with live status and deadline state
- `/create` — fund a task: agent address, spec text (keccak anchored on-chain),
  escrow amount, accept/work/review windows
- `/task/[id]` — full lifecycle view: spec, deliverable, dispute panel with the
  2-of-3 AI verdicts, archived reasoning (expandable), and role-aware actions
  (accept / submit / release / dispute / resolve / challenge / rate)

## API routes

- `/api/reasoning/[taskId]` — the oracle's archived AI reasoning rows for a task
- `/api/specs/[taskId]` — the registered spec text for a task

Both read `taskpay/data/` (the oracle's file archive; `TASKPAY_DATA_DIR`
overrides the path, `NEXT_PUBLIC_CHAIN_ID` the chain subdir).

## Configuration

| Env | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_TASKPAY_CONTRACT` | `0x7E1596…90c5` (testnet deploy) | contract to read/write |
| `NEXT_PUBLIC_CHAIN_ID` | `968` | chain subdir for the API routes |

Wallet: wagmi `injected` connector (MetaMask / any `window.ethereum` wallet on
BOT Chain). Add the network in your wallet:

- RPC `https://rpc.bohr.life`, chain id `968`, symbol `BOT`, explorer
  `https://scan.bohr.life` (testnet tBOT from the faucet).