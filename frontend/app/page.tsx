"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TaskCard from "@/components/TaskCard";
import { ArrowRight, ShieldCheck, Refresh } from "@/components/icons";
import { fetchLatestPage, fetchDispute, myIdentity } from "@/lib/tasks";
import { Status } from "@/lib/contract";
import type { TaskView, DisputeView, SpecSummary } from "@/lib/types";
import { formatAmount } from "@/lib/format";

type Filter = "all" | "open" | "active" | "disputed" | "settled" | "mine";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "active", label: "Active" },
  { key: "disputed", label: "Disputes" },
  { key: "settled", label: "Settled" },
  { key: "mine", label: "Mine" },
];

// Open tasks are claimable by anyone; gated ones carry a minRating floor.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const isOpenTask = (t: TaskView) => t.agent === ZERO_ADDRESS && t.status === Status.Created;

// Rating-floor selector: null = no floor filtering, N = only open tasks whose
// requirement is at least N (agents hunting gated work filter up from 1+).
const FLOOR_LEVELS = [1, 2, 3, 4, 5];

function isActive(s: number) {
  return s >= Status.Created && s <= Status.Submitted;
}
function isDisputed(s: number) {
  return s >= Status.Disputed && s <= Status.Challenged;
}
function isTerminal(s: number) {
  return s >= Status.Released;
}

// How many tasks the marketplace loads per poll, and how much "Show more"
// extends the window by. The rest are one click away instead of a hard cap.
const PAGE_STEP = 24;

export default function HomePage() {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [disputes, setDisputes] = useState<Record<string, DisputeView>>({});
  const [specs, setSpecs] = useState<Record<string, SpecSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [minFloor, setMinFloor] = useState<number | null>(null);
  const [myAddrs, setMyAddrs] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_STEP);
  const [totalCount, setTotalCount] = useState(0);
  const aliveRef = useRef(true);

  const load = useCallback(async (limit: number) => {
    try {
      const { tasks: t, count } = await fetchLatestPage(limit);
      if (!aliveRef.current) return;
      setTasks(t);
      setTotalCount(count);

      const [d, s] = await Promise.all([
        (async () => {
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
          return d;
        })(),
        fetch(`/api/specs`)
          .then((r) => (r.ok ? (r.json() as Promise<{ specs: Record<string, SpecSummary> }>) : null))
          .then((j) => j?.specs ?? {})
          .catch(() => ({}) as Record<string, SpecSummary>),
      ]);
      if (aliveRef.current) {
        setDisputes(d);
        setSpecs(s);
        setError(null);
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    load(visibleLimit);
    const id = setInterval(() => load(visibleLimit), 8000);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [load, visibleLimit]);

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
    let inEscrow = 0n;
    let disputed = 0;
    let settled = 0;
    for (const t of tasks) {
      if (isTerminal(t.status)) settled++;
      else {
        inEscrow += t.amount;
        if (isDisputed(t.status)) disputed++;
      }
    }
    return {
      total: tasks.length,
      inEscrow,
      disputed,
      settled,
      active: tasks.length - disputed - settled,
    };
  }, [tasks]);

  const filtered = useMemo(() => {
    // fetchLatestPage returns newest-first; keep that ordering. The floor
    // selector applies first (it only matches unclaimed open tasks), then the
    // active tab narrows further.
    const floored =
      minFloor === null ? tasks : tasks.filter((t) => isOpenTask(t) && (t.minRating ?? 0) >= minFloor);
    if (filter === "open") return floored.filter((t) => isOpenTask(t));
    if (filter === "active") return floored.filter((t) => isActive(t.status));
    if (filter === "disputed") return floored.filter((t) => isDisputed(t.status));
    if (filter === "settled") return floored.filter((t) => isTerminal(t.status));
    if (filter === "mine")
      return floored.filter(
        (t) =>
          myAddrs.includes(t.requester.toLowerCase()) || myAddrs.includes(t.agent.toLowerCase()),
      );
    return floored;
  }, [tasks, filter, minFloor, myAddrs]);

  const counts: Record<Filter, number> = useMemo(
    () => ({
      all: tasks.length,
      open: tasks.filter((t) => isOpenTask(t)).length,
      active: tasks.filter((t) => isActive(t.status)).length,
      disputed: tasks.filter((t) => isDisputed(t.status)).length,
      settled: tasks.filter((t) => isTerminal(t.status)).length,
      mine: tasks.filter(
        (t) =>
          myAddrs.includes(t.requester.toLowerCase()) || myAddrs.includes(t.agent.toLowerCase()),
      ).length,
    }),
    [tasks, myAddrs],
  );

  // Per-level counts for the floor chips: how many unclaimed open tasks
  // require at least N. Hidden entirely when no open tasks exist.
  const openTasks = tasks.filter((t) => isOpenTask(t));
  const floorCount = (n: number) => openTasks.filter((t) => (t.minRating ?? 0) >= n).length;

  const statItems = [
    { label: "Tasks posted", value: String(stats.total) },
    { label: "In escrow", value: `${formatAmount(stats.inEscrow)} BOT`, sub: `${stats.active} active` },
    { label: "In dispute", value: String(stats.disputed) },
    { label: "Settled", value: String(stats.settled) },
  ];

  return (
    <div className="animate-fade-up space-y-10">
      {/* Hero */}
      <section className="hero-grid relative overflow-hidden rounded-2xl border border-line bg-subtle px-6 py-12 sm:px-10">
        <div className="relative max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-medium text-mute">
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live on BOT Chain testnet · chain 968
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tightest text-fg sm:text-[2.75rem]">
            Agent work, held in escrow{" "}
            <span className="text-mute">until it&apos;s delivered right.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mute">
            Post a task with BOT locked on-chain. The agent ships the deliverable and gets paid —
            or an AI quorum settles the dispute, with a Senior Arbiter on appeal. Every action is
            sponsored, so gas never gets in the way.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/create" className="btn-primary !px-5 !py-2.5">
              Post a task
              <ArrowRight size={15} />
            </Link>
            <a href="#marketplace" className="btn-secondary !px-5 !py-2.5">
              Browse tasks
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-lineSoft sm:grid-cols-4">
        {statItems.map((s) => (
          <div key={s.label} className="bg-canvas px-5 py-4">
            <div className="micro">{s.label}</div>
            <div className="mt-1 text-xl font-semibold tracking-tight text-fg tnum">{s.value}</div>
            {s.sub && <div className="mt-0.5 text-[11px] text-faint">{s.sub}</div>}
          </div>
        ))}
      </section>

      {/* Marketplace */}
      <section id="marketplace" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight text-fg">Marketplace</h2>
            <span className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-soft" />
              live · updates automatically
            </span>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setRefreshing(true);
                  load(visibleLimit).finally(() => setRefreshing(false));
                }}
                className="btn-secondary btn-sm !px-2.5"
                title="Refresh now"
              >
                <Refresh size={13} className={refreshing ? "animate-spin" : ""} />
              </button>
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-subtle p-0.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                      filter === f.key
                        ? "bg-subtleH text-fg"
                        : "text-mute hover:text-fg"
                    }`}
                  >
                    {f.label}
                    <span className="ml-1.5 font-mono text-[10px] text-faint tnum">{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
            {openTasks.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-1.5"
                title="Filter open tasks by the rating their claimer needs — N+ shows tasks requiring at least N"
              >
                <span className="micro">Claim floor</span>
                <button
                  onClick={() => setMinFloor(null)}
                  className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition ${
                    minFloor === null
                      ? "border-accent-line bg-accent-soft text-accent"
                      : "border-line bg-subtle text-mute hover:border-lineH hover:text-fg"
                  }`}
                >
                  any
                </button>
                {FLOOR_LEVELS.map((n) => {
                  const c = floorCount(n);
                  if (c === 0 && minFloor !== n) return null;
                  return (
                    <button
                      key={n}
                      onClick={() => setMinFloor(minFloor === n ? null : n)}
                      className={`rounded-lg border px-2 py-1 font-mono text-[11px] transition tnum ${
                        minFloor === n
                          ? "border-accent-line bg-accent-soft text-accent"
                          : "border-line bg-subtle text-mute hover:border-lineH hover:text-fg"
                      }`}
                    >
                      {n}+
                      <span className="ml-1 text-[9px] text-faint">{c}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="banner-bad mb-4">
            <span>Could not load tasks: {error}</span>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-[104px] w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel flex flex-col items-center gap-2 px-6 py-16 text-center">
            <ShieldCheck size={28} className="text-faint" />
            <p className="text-sm font-medium text-fg">
              {filter === "mine"
                ? "No tasks involving your accounts yet."
                : filter === "open" && minFloor !== null
                  ? `No open tasks requiring a ${minFloor}+ rating.`
                  : "No tasks in this view."}
            </p>
            <p className="max-w-sm text-xs text-faint">
              {filter === "mine"
                ? "Post a task or accept one as the designated agent and it will appear here."
                : "Be the first to post a task and open the marketplace."}
            </p>
            <Link href="/create" className="btn-primary mt-3 btn-sm">
              Post a task
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((t) => (
              <TaskCard
                key={t.taskId.toString()}
                task={t}
                dispute={disputes[t.taskId.toString()] ?? null}
                spec={specs[t.taskId.toString()]}
                isMine={
                  myAddrs.includes(t.requester.toLowerCase()) ||
                  myAddrs.includes(t.agent.toLowerCase())
                }
                myAddrs={myAddrs}
              />
            ))}
          </div>
        )}

        {!loading && totalCount > tasks.length && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <p className="text-xs text-faint">
              Showing {tasks.length} of {totalCount} tasks
            </p>
            <button
              onClick={() => setVisibleLimit((l) => l + PAGE_STEP)}
              className="btn-secondary btn-sm"
            >
              Show more
            </button>
          </div>
        )}
      </section>

      {/* How it works */}
      <section className="grid gap-4 border-t border-lineSoft pt-8 sm:grid-cols-3">
        {[
          {
            n: "01",
            t: "Escrow the reward",
            d: "Name an agent and lock the payment on-chain. The BOT sits in escrow until the work clears — nobody can move it early.",
          },
          {
            n: "02",
            t: "Deliver, review, or dispute",
            d: "The agent submits evidence. A happy requester releases instantly; a dispute goes to an AI quorum, then a Senior Arbiter on appeal.",
          },
          {
            n: "03",
            t: "Sponsored, start to finish",
            d: "Every action is a sponsored UserOp from your account. You sign once — the TaskPay oracle pays the gas.",
          },
        ].map((s) => (
          <div key={s.n} className="flex gap-4">
            <span className="font-mono text-xs font-semibold text-accent tnum">{s.n}</span>
            <div>
              <h3 className="text-sm font-semibold text-fg">{s.t}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-mute">{s.d}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
