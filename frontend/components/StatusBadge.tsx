"use client";

import { STATUS_LABELS, Status } from "@/lib/contract";

const TONES: Record<number, { pill: string; dot: string }> = {
  [Status.Created]: {
    pill: "text-zinc-400 border-white/10 bg-white/[0.03]",
    dot: "bg-zinc-400",
  },
  [Status.Accepted]: {
    pill: "text-sky-300 border-sky-500/25 bg-sky-500/10",
    dot: "bg-sky-400",
  },
  [Status.Submitted]: {
    pill: "text-violet-300 border-violet-500/25 bg-violet-500/10",
    dot: "bg-violet-400",
  },
  [Status.Disputed]: {
    pill: "text-amber-300 border-amber-500/25 bg-amber-500/10",
    dot: "bg-amber-400",
  },
  [Status.PendingChallenge]: {
    pill: "text-orange-300 border-orange-500/25 bg-orange-500/10",
    dot: "bg-orange-400",
  },
  [Status.Challenged]: {
    pill: "text-fuchsia-300 border-fuchsia-500/25 bg-fuchsia-500/10",
    dot: "bg-fuchsia-400",
  },
  [Status.Released]: {
    pill: "text-emerald-300 border-emerald-500/25 bg-emerald-500/10",
    dot: "bg-emerald-400",
  },
  [Status.Refunded]: {
    pill: "text-rose-300 border-rose-500/25 bg-rose-500/10",
    dot: "bg-rose-400",
  },
  [Status.Cancelled]: {
    pill: "text-zinc-500 border-white/10 bg-white/[0.02]",
    dot: "bg-zinc-500",
  },
};

export default function StatusBadge({
  status,
  pulse,
}: {
  status: number;
  pulse?: boolean;
}) {
  const t = TONES[status] ?? TONES[Status.Cancelled];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${t.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot} ${pulse ? "animate-pulse-soft" : ""}`} />
      {STATUS_LABELS[status] ?? `Status ${status}`}
    </span>
  );
}
