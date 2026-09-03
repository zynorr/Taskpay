"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TaskCard from "@/components/TaskCard";
import { fetchAllTasks } from "@/lib/tasks";
import type { TaskView } from "@/lib/types";
import { CONTRACT_ADDRESS, STATUS_LABELS } from "@/lib/contract";
import { shortAddress } from "@/lib/format";

export default function HomePage() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await fetchAllTasks();
        if (!cancelled) setTasks(t.reverse());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Task marketplace</h1>
        <p className="mt-1 text-sm text-slate-400">
          Escrowed BOT for agent work. Requester releases or disputes; the AI
          quorum rules on disputes; a Senior Arbiter settles appeals.
        </p>
        <p className="mt-2 font-mono text-xs text-slate-500">
          contract {shortAddress(CONTRACT_ADDRESS)} · BOT Chain testnet 968
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-900 bg-rose-950/50 p-3 text-sm text-rose-300">
          Failed to load tasks: {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center text-sm text-slate-400">
          No tasks yet.{" "}
          <Link href="/create" className="font-medium text-indigo-400 hover:text-indigo-300">
            Create the first one
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <TaskCard key={t.taskId.toString()} task={t} />
          ))}
        </div>
      )}

      <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-500">
        <span className="font-semibold text-slate-400">Statuses:</span>{" "}
        {Object.entries(STATUS_LABELS)
          .map(([k, v]) => `${k} = ${v}`)
          .join(" · ")}
      </div>
    </div>
  );
}