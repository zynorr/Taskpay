import Link from "next/link";
import StatusBadge from "./StatusBadge";
import { shortAddress, formatAmount, timeLeft } from "@/lib/format";
import type { TaskView } from "@/lib/types";

export default function TaskCard({ task }: { task: TaskView }) {
  return (
    <Link
      href={`/task/${task.taskId}`}
      className="block rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-indigo-600"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-sm text-slate-400">task #{task.taskId.toString()}</span>
        <StatusBadge status={task.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">Requester</div>
          <div className="font-mono">{shortAddress(task.requester)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Agent</div>
          <div className="font-mono">{shortAddress(task.agent)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Escrow</div>
          <div>{formatAmount(task.amount)} BOT</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">
            {task.status === 0
              ? "Accept window"
              : task.status === 1
                ? "Work deadline"
                : task.status === 2
                  ? "Review window"
                  : "Updated"}
          </div>
          <div className="font-mono text-xs">
            {task.status === 0
              ? timeLeft(task.acceptDeadline)
              : task.status === 1
                ? timeLeft(task.workDeadline)
                : task.status === 2
                  ? timeLeft(task.reviewDeadline)
                  : "—"}
          </div>
        </div>
      </div>
    </Link>
  );
}