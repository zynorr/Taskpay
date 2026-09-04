# TaskPay — Deployment Guide

## Networks

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | **968** (0x3c8) | **677** (0x2a5) |
| RPC | https://rpc.bohr.life | https://rpc.botchain.ai |
| Explorer | https://scan.bohr.life | https://scan.botchain.ai |
| Bundler (later phase) | https://bundler.bohr.life/rpc | — |
| Faucet | https://faucet.botchain.ai (10 tBOT / 24h) | — |
| Gas | tBOT | BOT |

Chain facts: 0.75s block time, ~$0.06 average tx fee. Blocks are fast — use
conservative confirmation waits in scripts.

## Prereqs

- [Foundry](https://getfoundry.sh) (forge/cast).
- A funded deployer wallet on the target network.
- `taskpay/.env` (never commit). Required vars:

```bash
PRIVATE_KEY=0x...          # deployer = contract owner
ORACLE_ADDRESS=0x...       # the EOA the oracle service signs with (see oracle/)
CHAIN_ID=968               # 968 testnet / 677 mainnet
```

## Deploy

Constructor: `(address oracle, uint256 challengeWindow, uint256 seniorArbiterWindow)`.

Suggested timing windows:

| Param | Testnet (demo) | Mainnet |
|---|---|---|
| challengeWindow | 5 minutes | 3 days |
| seniorArbiterWindow | 5 minutes | 1 day |

```bash
cd taskpay
set -a; source .env; set +a

forge script script/Deploy.s.sol \
  --rpc-url https://rpc.bohr.life \
  --chain-id 968 \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

The script logs the deployed address, oracle, windows, and owner. Verify the
source on the explorer afterwards (public RPCs may cap `eth_getLogs`, so
verification is done via the explorer UI).

> **No compiled-in chain config exists in the client for 677** — mainnet is
> reached by RPC URL only. Pass the chain id explicitly in every call; do not
> rely on auto-detection.

## ERC-4337 sponsor stack (Phase 4)

TaskPay runs its own account-abstraction stack on testnet so users never pay
gas. The canonical **EntryPoint v0.7** is already live at
`0x0000000071727De22E5E9d8BAf0edAc6f37da032` (bytecode verified identical to
mainnet). Only the factory + paymaster need deploying:

```bash
# ENTRY_POINT (optional), VERIFYING_SIGNER defaults to the deployer. Set it to
# the oracle address: the oracle signs paymaster approvals AND broadcasts
# handleOps (it is the bundler).
VERIFYING_SIGNER=$ORACLE_ADDRESS forge script script/DeployAA.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Then fund the paymaster's gas deposit inside the EntryPoint:

```bash
cast send --rpc-url $RPC_URL --private-key $PRIVATE_KEY \
  <PAYMASTER_ADDRESS> "deposit()" --value 1ether
# verify: cast call <ENTRY_POINT> "balanceOf(address)(uint256)" <PAYMASTER_ADDRESS>
```

Current testnet deployments (968):

| Contract | Address |
|---|---|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SimpleAccountFactory | `0xFbfBBD060b1d4E7Edae6D9e58C73F731927b2f2b` |
| VerifyingPaymaster | `0x8Ed5e3054A98a6528B666Ca99411648B94A0fDF0` |

Point `ENTRY_POINT` / `AA_FACTORY` / `PAYMASTER` in taskpay/.env at these and
run the oracle on `PORT=8787` — it serves the bundler endpoints the frontend
calls. See the repo README's Phase 4 section and `scripts/live_gasless.mjs`.

## Post-deploy checklist

1. Confirm `owner()` and `oracle()` on the explorer.
2. `setFee(bps)` — start at 0 (or 50 = 0.5%) and confirm the event.
3. Drive one full cycle on testnet first:
   create → accept → submit → release, then create → accept → submit →
   dispute → (oracle verdicts ×2) → resolve → challenge → senior arbiter.

## Public deployment (Render)

The repo ships a Render blueprint (`render.yaml`) plus a `Dockerfile` that
builds both the oracle and the frontend into one image, so a **single web
service** exposes the app on one port while the persistent disk is shared by
both processes (Render mounts a disk to one service only — keeping them in
one container is what lets them share `data/`).

### Deploy

1. Push to GitHub (repo: `zynorr/Taskpay`).
2. Render dashboard → **New → Blueprint** → select the repo, branch `main`.
   `render.yaml` provisions the service, disk (`/data`, 1 GB) and env group.
3. In the service's **Environment** tab, fill the two `sync: false` secrets:
   - `ORACLE_PRIVATE_KEY` — the oracle signer EOA (same as `ORACLE_ADDRESS`).
   - `GROQ_API_KEY` — the AI agents' key.
4. Deploy. The frontend answers on `https://<service>.onrender.com`.

### How it fits together

| Piece | Where | Port |
|---|---|---|
| Oracle (poller + sponsor bundler) | same container, internal | 8787 |
| Next.js frontend | same container, public | 3000 |
| Persistent disk | mounted at `/data` (`TASKPAY_DATA_DIR=/data`) | — |

- The browser never reaches 8787: `NEXT_PUBLIC_BUNDLER_URL=/api/bundler` and
  the Next route `app/api/bundler/v1/[route]/route.ts` proxies
  `/api/bundler/v1/quote|send` → `127.0.0.1:8787/v1/...` (`ORACLE_INTERNAL_URL`).
- Archives (specs, reasoning, disputes) live on `/data` and survive redeploys;
  the oracle resumes its poller from the persisted cursor file there.
- The oracle's `/health` (internal 8787) reports the paymaster deposit; refill
  with `EntryPoint.depositTo(paymaster)` from any funded EOA when it drops
  (warn at 0.02 tBOT, critical at 0.005 tBOT).
- The sponsor endpoints are rate-limited per address (20 ops/min,
  `ORACLE_BUNDLER_RATE_LIMIT`) — enough for a human lifecycle, not a faucet.

### Free-tier caveats

- Free instances **sleep after ~15 min idle** and wake on the next request;
  the poller only runs while the instance is awake. Uptime monitoring (e.g.
  Render cron/UptimeRobot hitting `/`) keeps it warm for demos.
- Disk is billed separately once the plan needs it; 1 GB covers thousands of
  archive files.

### Split services later (optional)

When the app outgrows one container: run the oracle as its own service
(public `8787` + rate limit + a reverse-proxy allowlist) and point
`NEXT_PUBLIC_BUNDLER_URL` at it, mounting the disk on the oracle and letting
the frontend read archives through a read-only archive API on the oracle.

## Security notes for the deployer

- Funds are escrowed **in the contract**; the deployer is `owner` with admin
  powers only (fee, oracle, windows). Owner cannot move task balances.
- The oracle address is **privileged** (verdicts, senior arbiter). Keep it as a
  separate low-balance wallet; rotate via `setOracle()` if compromised. A rogue
  oracle can stall or bias disputes but never steal — funds only ever flow to
  the requester or the agent.
- Fee accrual sits in `treasuryBalance` until `withdrawTreasury`; withdraw to a
  multisig once volume justifies it.
