import { formatUnits } from "viem";
import { targetChain } from "./chains";

/** Shorten an address: 0x1234…abcd */
export function shortAddress(addr: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Shorten a hash: 0x12345678…90abcdef */
export function shortHash(h: string): string {
  if (!h || h === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    return "";
  }
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

/** Full copy of a hash (as-is). */
export function fullHash(h: string): string {
  return h ?? "";
}

export function formatAmount(wei: bigint, decimals = 18): string {
  return formatUnits(wei, decimals);
}

export function formatTimestamp(ts: bigint): string {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFullTimestamp(ts: bigint): string {
  if (ts === 0n) return "—";
  return new Date(Number(ts) * 1000).toLocaleString();
}

/**
 * Seconds → compact friendly duration ("3h 12m", "2d 4h", "45s").
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Seconds → human label for a duration setting ("1 hour", "7 days"). */
export function formatDurationLabel(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86400) {
    const h = seconds / 3600;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? "" : "s"}`;
  }
  const d = seconds / 86400;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} day${d === 1 ? "" : "s"}`;
}

export type DeadlineUrgency = "ok" | "soon" | "critical" | "expired";

/** How close a deadline is, for coloring. */
export function deadlineUrgency(ts: bigint): DeadlineUrgency {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (ts <= now) return "expired";
  const left = Number(ts - now);
  if (left < 60 * 30) return "critical";
  if (left < 60 * 60 * 12) return "soon";
  return "ok";
}

export function timeLeft(ts: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (ts <= now) return "expired";
  return formatDuration(Number(ts - now));
}

/** Explorer link for an address. */
export function explorerAddress(addr: string): string {
  const base = targetChain.blockExplorers?.default.url ?? "https://scan.bohr.life";
  return `${base}/address/${addr}`;
}

/** Explorer link for a transaction hash. */
export function explorerTx(hash: string): string {
  const base = targetChain.blockExplorers?.default.url ?? "https://scan.bohr.life";
  return `${base}/tx/${hash}`;
}

/**
 * Display title + short summary for a task's spec. Uses the explicitly
 * registered name when present; otherwise falls back to the first line of
 * the spec text so legacy tasks (archived before names existed) still get a
 * meaningful heading. `summary` is the trimmed remainder of the spec text.
 */
export function taskTitle(name: string | undefined, specText: string | null | undefined): string {
  if (name?.trim()) return name.trim();
  if (specText) {
    const first = specText.split(/\r?\n/)[0]?.trim();
    if (first) return first.length > 90 ? `${first.slice(0, 90).trimEnd()}…` : first;
  }
  return "Untitled task";
}

/**
 * One-line summary of the spec text. For a spec stored as a single prose
 * paragraph this returns null (the title is already that text); for specs
 * written as a heading line + body it returns the body, trimmed and clamped.
 */
export function taskSummary(specText: string | null | undefined): string | null {
  if (!specText) return null;
  const lines = specText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const first = lines[0];
  const rest = lines.slice(1).join(" ").trim();
  // A single-paragraph spec is often stored as one long line — only treat it
  // as heading+body when the remainder differs from the heading.
  if (!rest || rest === first) return null;
  return rest.length > 160 ? `${rest.slice(0, 160).trimEnd()}…` : rest;
}

/** True when a submission looks like a URL (for rendering a link). */
export function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/\S+$/.test(s.trim());
}

/** async copy to clipboard with fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}