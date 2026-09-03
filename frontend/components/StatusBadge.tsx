import { STATUS_LABELS } from "@/lib/contract";

const COLORS: Record<number, string> = {
  0: "bg-slate-700 text-slate-200",
  1: "bg-blue-900 text-blue-200",
  2: "bg-cyan-900 text-cyan-200",
  3: "bg-amber-900 text-amber-200",
  4: "bg-orange-900 text-orange-200",
  5: "bg-purple-900 text-purple-200",
  6: "bg-emerald-900 text-emerald-200",
  7: "bg-rose-900 text-rose-200",
  8: "bg-slate-800 text-slate-400",
};

export default function StatusBadge({ status }: { status: number }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COLORS[status] ?? "bg-slate-700 text-slate-200"}`}
    >
      {STATUS_LABELS[status] ?? `Status ${status}`}
    </span>
  );
}