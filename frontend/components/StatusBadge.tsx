"use client";

import { STATUS_LABELS, Status } from "@/lib/contract";

const TONES: Record<number, { pill: string; dot: string }> = {
  [Status.Created]: {
    pill: "text-mute border-line bg-subtle",
    dot: "bg-zinc-500",
  },
  [Status.Accepted]: {
    pill: "text-info border-info-line bg-info-soft",
    dot: "bg-sky-500",
  },
  [Status.Submitted]: {
    pill: "text-vio border-vio-line bg-vio-soft",
    dot: "bg-violet-500",
  },
  [Status.Disputed]: {
    pill: "text-warn border-warn-line bg-warn-soft",
    dot: "bg-amber-500",
  },
  [Status.PendingChallenge]: {
    pill: "text-warn2 border-warn2-line bg-warn2-soft",
    dot: "bg-orange-500",
  },
  [Status.Challenged]: {
    pill: "text-fu border-fu-line bg-fu-soft",
    dot: "bg-fuchsia-500",
  },
  [Status.Released]: {
    pill: "text-ok border-ok-line bg-ok-soft",
    dot: "bg-emerald-500",
  },
  [Status.Refunded]: {
    pill: "text-bad border-bad-line bg-bad-soft",
    dot: "bg-rose-500",
  },
  [Status.Cancelled]: {
    pill: "text-faint border-line bg-subtle",
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
