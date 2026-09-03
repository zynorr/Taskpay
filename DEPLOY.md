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

## Post-deploy checklist

1. Confirm `owner()` and `oracle()` on the explorer.
2. `setFee(bps)` — start at 0 (or 50 = 0.5%) and confirm the event.
3. Drive one full cycle on testnet first:
   create → accept → submit → release, then create → accept → submit →
   dispute → (oracle verdicts ×2) → resolve → challenge → senior arbiter.

## Security notes for the deployer

- Funds are escrowed **in the contract**; the deployer is `owner` with admin
  powers only (fee, oracle, windows). Owner cannot move task balances.
- The oracle address is **privileged** (verdicts, senior arbiter). Keep it as a
  separate low-balance wallet; rotate via `setOracle()` if compromised. A rogue
  oracle can stall or bias disputes but never steal — funds only ever flow to
  the requester or the agent.
- Fee accrual sits in `treasuryBalance` until `withdrawTreasury`; withdraw to a
  multisig once volume justifies it.
