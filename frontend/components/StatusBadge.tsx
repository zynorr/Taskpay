"use client";

import { STATUS_LABELS, Status } from "@/lib/contract";

const STYLES: Record<number, { dot: string; pill: string }> = {
  [Status.Created]: {
    dot: "bg-sky-400",
    pill: "border-sky-800/50 bg-sky-950/40 text-sky-300",
  },
  [Status.Accepted]: {
    dot: "bg-blue-400",
    pill: "border-blue-800/50 bg-blue-950/40 text-blue-300",
  },
  [Status.Submitted]: {
    dot: "bg-cyan-400",
    pill: "border-cyan-800/50 bg-cyan-950/40 text-cyan-300",
  },
  [Status.Disputed]: {
    dot: "bg-amber-400",
    pill: "border-amber-800/50 bg-amber-950/40 text-amber-300",
  },
  [Status.PendingChallenge]: {
    dot: "bg-orange-400",
    pill: "border-orange-800/50 bg-orange-950/40 text-orange-300",
  },
  [Status.Challenged]: {
    dot: "bg-violet-400",
    pill: "border-violet-800/50 bg-violet-950/40 text-violet-300",
  },
  [Status.Released]: {
    dot: "bg-emerald-400",
    pill: "border-emerald-800/50 bg-emerald-950/40 text-emerald-300",
  },
  [Status.Refunded]: {
    dot: "bg-rose-400",
    pill: "border-rose-800/50 bg-rose-950/40 text-rose-300",
  },
  [Status.Cancelled]: {
    dot: "bg-slate-500",
    pill: "border-slate-700 bg-slate-800/60 text-slate-400",
  },
};

export default function StatusBadge({ status, pulse }: { status: number; pulse?: boolean }) {
  const s = STYLES[status] ?? STYLES[Status.Cancelled];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.pill}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${s.dot} ${pulse ? "animate-pulse-dot" : ""}`}
      />
      {STATUS_LABELS[status] ?? `Status ${status}`}
    </span>
  );
}