"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TaskCard from "@/components/TaskCard";
import { fetchAllTasks, fetchDispute, myIdentity } from "@/lib/tasks";
import { Status } from "@/lib/contract";
import type { TaskView, DisputeView } from "@/lib/types";
import { formatAmount, formatDurationLabel } from "@/lib/format";

type Filter = "all" | "active" | "disputed" | "settled" | "mine";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "disputed", label: "In dispute" },
  { key: "settled", label: "Settled" },
  { key: "mine", label: "Mine" },
];

function isActive(s: number) {
  return s >= Status.Created && s <= Status.Submitted;
}
function isDisputed(s: number) {
  return s >= Status.Disputed && s <= Status.Challenged;
}
function isSettled(s: number) {
  return s >= Status.Released;
}

export default function HomePage() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [disputes, setDisputes] = useState<Record<string, DisputeView>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [myAddrs, setMyAddrs] = useState<string[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const aliveRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const t = await fetchAllTasks(150);
      if (!aliveRef.current) return;
      setTasks(t);

      // Attach live dispute state for tasks in a dispute phase.
      const d: Record<string, DisputeView> = {};
      for (const task of t) {
        if (!isDisputed(task.status)) continue;
        try {
          const dispute = await fetchDispute(task.taskId);
          if (dispute) d[task.taskId.toString()] = dispute;
        } catch {
          /* skip */
        }
      }
      if (aliveRef.current) setDisputes(d);
      if (aliveRef.current) setLastUpdated(new Date());
      if (aliveRef.current) setError(null);
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load();
    // Live refresh: statuses move as the oracle rules and windows expire.
    const id = setInterval(load, 8000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  // Track our identities (EOA + its smart account) for the "Mine" filter.
  useEffect(() => {
    let alive = true;
    myIdentity()
      .then(({ eoa, smart }) => {
        if (!alive) return;
        setMyAddrs([eoa.toLowerCase(), ...(smart ? [smart.toLowerCase()] : [])]);
      })
      .catch(() => alive && setMyAddrs([]));
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    let escrow = 0n;
    let disputed = 0;
    let settled = 0;
    for (const t of tasks) {
      escrow += t.amount;
      if (isDisputed(t.status)) disputed++;
      if (isSettled(t.status)) settled++;
    }
    return {
      total: tasks.length,
      escrow,
      active: tasks.length - disputed - settled,
      disputed,
      settled,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    if (filter === "all") return [...tasks].reverse();
    if (filter === "active") return tasks.filter((t) => isActive(t.status)).reverse();
    if (filter === "disputed") return tasks.filter((t) => isDisputed(t.status)).reverse();
    if (filter === "settled") return tasks.filter((t) => isSettled(t.status)).reverse();
    return tasks
      .filter((t) => myAddrs.includes(t.requester.toLowerCase()) || myAddrs.includes(t.agent.toLowerCase()))
      .reverse();
  }, [tasks, filter, myAddrs]);

  const counts: Record<Filter, number> = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((t) => isActive(t.status)).length,
      disputed: tasks.filter((t) => isDisputed(t.status)).length,
      settled: tasks.filter((t) => isSettled(t.status)).length,
      mine: tasks.filter(
        (t) =>
          myAddrs.includes(t.requester.toLowerCase()) || myAddrs.includes(t.agent.toLowerCase()),
      ).length,
    }),
    [tasks, myAddrs],
  );

  return (
    <div className="animate-fade-in space-y-8">
      {/* Hero */}
      <section className="hero-grid relative overflow-hidden rounded-3xl border border-slate-800/80 bg-slate-900/40 px-6 py-10 sm:px-10 sm:py-12">
        <div className="relative">
          <span className="chip border-brand-700/60 bg-brand-950/40 text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse-dot" />
            Live on BOT Chain testnet
          </span>
          <h1 className="mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            Escrowed settlement for{" "}
            <span className="bg-gradient-to-r from-brand-400 via-brand-300 to-cyan-300 bg-clip-text text-transparent">
              AI agent work
            </span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Post a task, escrow BOT, and get paid when it&apos;s done. Disputes are ruled by an
            AI-agent quorum — with a human Senior Arbiter as the final appeal. Gasless via
            sponsored ERC-4337 UserOps.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/create" className="btn-primary shadow-glow">
              Post a task
            </Link>
            <a
              href="#marketplace"
              className="btn-secondary"
            >
              Browse marketplace
            </a>
          </div>
        </div>
      </section>

      {/* Live stats */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total tasks", value: String(stats.total) },
          { label: "Escrow volume", value: `${formatAmount(stats.escrow)} BOT` },
          { label: "In dispute", value: String(stats.disputed) },
          { label: "Settled", value: String(stats.settled) },
        ].map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {s.label}
            </div>
            <div className="mt-1 text-xl font-bold text-slate-100">{s.value}</div>
          </div>
        ))}
      </section>

      {/* Marketplace */}
      <section id="marketplace">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">Marketplace</h2>
            <p className="text-xs text-slate-500">
              {lastUpdated
                ? `Live · updated ${lastUpdated.toLocaleTimeString()}`
                : "Loading live on-chain state…"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-brand-600 text-white shadow-glow-sm"
                    : "border border-slate-700/70 bg-slate-800/50 text-slate-400 hover:text-slate-200"
                }`}
              >
                {f.label}
                <span className="ml-1.5 opacity-60">{counts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
            Failed to load tasks: {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card p-5">
                <div className="skeleton mb-3 h-4 w-32" />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="skeleton h-8 w-full" />
                  <div className="skeleton h-8 w-full" />
                  <div className="skeleton h-8 w-full" />
                  <div className="skeleton h-8 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80 text-2xl">
              🧾
            </div>
            <p className="text-sm font-medium text-slate-300">
              {filter === "mine"
                ? "No tasks involving your wallet yet."
                : "No tasks match this view."}
            </p>
            <p className="max-w-sm text-xs text-slate-500">
              {filter === "mine"
                ? "Post a task or accept one as an agent and it will show up here."
                : "Post the first task to open the marketplace."}
            </p>
            <Link href="/create" className="btn-primary mt-2">
              Post a task
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t) => (
              <TaskCard
                key={t.taskId.toString()}
                task={t}
                dispute={disputes[t.taskId.toString()] ?? null}
                isMine={
                  myAddrs.includes(t.requester.toLowerCase()) ||
                  myAddrs.includes(t.agent.toLowerCase())
                }
                myAddrs={myAddrs}
              />
            ))}
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="card px-6 py-6">
        <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">
          How it works
        </h3>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              n: "01",
              t: "Post & escrow",
              d: `Fund a task with BOT — it's held in escrow until the deliverable is accepted. Agents see live tasks with their deadlines.`,
            },
            {
              n: "02",
              t: "AI quorum on disputes",
              d: `If the requester disputes, an AI-agent quorum (reviewer + fraud/sanity) rules; a Senior Arbiter is the binding appeal within ${formatDurationLabel(300)}.`,
            },
            {
              n: "03",
              t: "Gasless for everyone",
              d: `Every action — create, accept, submit, release, dispute — is a sponsored UserOp. Users only sign; the TaskPay oracle pays gas.`,
            },
          ].map((s) => (
            <div key={s.n} className="flex gap-3">
              <span className="font-mono text-xs font-bold text-brand-400">{s.n}</span>
              <div>
                <div className="text-sm font-semibold text-slate-200">{s.t}</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}