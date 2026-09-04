import { Contract } from "ethers";
import { formatEther } from "ethers";
import { env } from "../config/env.js";
import { provider } from "../contract/client.js";
import { logger } from "../lib/logger.js";
import entryPointAbi from "../bundler/abi/EntryPoint.json" with { type: "json" };

// The paymaster deposit at the EntryPoint is the gas budget for every
// sponsored UserOp (the paymaster is debited the tx cost at postOp). One
// handleOps run costs roughly 0.001-0.002 tBOT at BOT Chain's fixed 20 gwei,
// so warn when the budget covers only a handful of ops, and scream when it is
// about to hard-stop every gasless action ("AA31 paymaster deposit too low").
export const PAYMASTER_WARN_DEPOSIT = 20_000_000_000_000_000n; // 0.02 tBOT ≈ 10-20 ops
export const PAYMASTER_CRITICAL_DEPOSIT = 5_000_000_000_000_000n; // 0.005 tBOT ≈ 3-5 ops

export type DepositLevel = "ok" | "warn" | "critical" | "not_configured" | "unknown";

export function depositLevel(deposit: bigint | null): DepositLevel {
  if (deposit === null) return "unknown";
  if (deposit < PAYMASTER_CRITICAL_DEPOSIT) return "critical";
  if (deposit < PAYMASTER_WARN_DEPOSIT) return "warn";
  return "ok";
}

export interface DepositSnapshot {
  deposit: string | null; // formatted tBOT, or null when unknown/not configured
  depositWei: string | null;
  level: DepositLevel;
  checkedAt: number | null; // epoch ms
}

/**
 * Periodically reads the VerifyingPaymaster's deposit at the EntryPoint,
 * logs once per level transition (never spams every tick while low), and
 * keeps a cached snapshot the /health endpoint can serve without blocking on
 * RPC. Pure in-memory state — a restart simply re-checks on boot.
 */
export class PaymasterDepositMonitor {
  private last: DepositSnapshot = { deposit: null, depositWei: null, level: "unknown", checkedAt: null };
  private lastLoggedLevel: DepositLevel | null = null;
  private timer?: NodeJS.Timeout;

  async check(): Promise<void> {
    if (!env.PAYMASTER || !env.ENTRY_POINT) {
      this.last = { deposit: null, depositWei: null, level: "not_configured", checkedAt: Date.now() };
      return;
    }
    let deposit: bigint | null = null;
    try {
      // JSON-imported ABIs lose per-function typing, so narrow the surface.
      const entryPoint = new Contract(env.ENTRY_POINT, entryPointAbi, provider) as unknown as {
        deposits(account: string): Promise<[bigint, boolean, bigint, number, number]>;
      };
      // DepositInfo tuple: (deposit, staked, stake, unstakeDelaySec, withdrawTime)
      const info = await entryPoint.deposits(env.PAYMASTER);
      deposit = info[0] ?? null;
    } catch (err) {
      logger.error("paymaster_deposit_read_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const level = depositLevel(deposit);
    this.last = {
      deposit: deposit === null ? null : formatEther(deposit),
      depositWei: deposit === null ? null : deposit.toString(),
      level,
      checkedAt: Date.now(),
    };

    if (level === this.lastLoggedLevel) return; // no spam while staying low
    this.lastLoggedLevel = level;
    if (level === "warn") {
      logger.warn("paymaster_deposit_low", {
        deposit: this.last.deposit,
        warnBelow: formatEther(PAYMASTER_WARN_DEPOSIT),
        criticalBelow: formatEther(PAYMASTER_CRITICAL_DEPOSIT),
        hint: "refill via EntryPoint.depositTo(paymaster)",
      });
    } else if (level === "critical") {
      logger.error("paymaster_deposit_critical", {
        deposit: this.last.deposit,
        hint: "gasless actions will soon revert with AA31 — refill now",
      });
    } else {
      logger.info("paymaster_deposit", { deposit: this.last.deposit, level });
    }
  }

  start(intervalMs = 60_000): void {
    void this.check(); // immediate check on boot
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  snapshot(): DepositSnapshot {
    return this.last;
  }
}