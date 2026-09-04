"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { isAddress } from "viem";
import StatusBadge from "@/components/StatusBadge";
import { ArrowLeft, ArrowUpRight, Award, Copy, History, Person, Star, Scale } from "@/components/icons";
import {
  fetchAgentRating,
  fetchAgentRatingRows,
  fetchAgentCompletedCount,
  fetchTaskHistory,
  fetchDisputedTaskIds,
  isDisputeRange,
} from "@/lib/tasks";
import {
  shortAddress,
  formatAmount,
  formatTimestamp,
  explorerAddress,
  copyText,
  taskTitle,
} from "@/lib/format";
import type { AgentRatingRow, SpecSummary, TaskView } from "@/lib/types";

function stars(avg: number) {
  return [1, 2, 3, 4, 5].map((n) => (
    <Star
      key={n}
      size={14}
      className={n <= Math.round(avg) ? "text-amber-500" : "text-faint"}
    />
  ));
}

export default function AgentProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const [address, setAddress] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [summary, setSummary] = useState<{ totalScore: bigint; count: bigint } | null>(null);
  const [completed, setCompleted] = useState(0);
  const [ratings, setRatings] = useState<AgentRatingRow[]>([]);
  const [history, setHistory] = useState<TaskView[]>([]);
  const [specs, setSpecs] = useState<Record<string, SpecSummary>>({});
  const [disputedIds, setDisputedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ address: a }) => {
      const norm = a.toLowerCase();
      if (isAddress(norm)) setAddress(norm);
      else setInvalid(true);
    });
  }, [params]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const [s, c, r, t, specMap] = await Promise.all([
        fetchAgentRating(address),
        fetchAgentCompletedCount(address),
        fetchAgentRatingRows(address),
        fetchTaskHistory(address),
        fetch(`/api/specs`)
          .then((res) => (res.ok ? (res.json() as Promise<{ specs: Record<string, SpecSummary> }>) : null))
          .then((j) => j?.specs ?? {})
          .catch(() => ({}) as Record<string, SpecSummary>),
      ]);
      setSummary(s);
      setCompleted(c);
      setRatings(r);

      // The agent's own work (they were the counterparty doing the task);
      // requester-led tasks stay out of the work history.
      const agentTasks = t
        .filter((task) => task.agent.toLowerCase() === address)
        .sort((x, y) => (x.taskId < y.taskId ? 1 : -1)); // newest first
      setHistory(agentTasks);

      // Was a task ever disputed? Shared with the create-flow reputation
      // warning (fetchDisputedTaskIds) so both surfaces read the same signal.
      const flagged = await fetchDisputedTaskIds(agentTasks);
      setDisputedIds(new Set(Array.from(flagged, String)));
      setSpecs(specMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const avg = summary && summary.count > 0n ? Number(summary.totalScore) / Number(summary.count) : null;
  const disputedCount = disputedIds.size;

  const statItems = [
    { label: "Avg rating", value: avg === null ? "—" : avg.toFixed(1), sub: avg === null ? "not rated yet" : `${summary?.count ?? 0n} rating${summary?.count === 1n ? "" : "s"}` },
    { label: "Tasks completed", value: String(completed), sub: "released on-chain" },
    { label: "Disputes", value: String(disputedCount), sub: `${history.length} task${history.length === 1 ? "" : "s"} as agent` },
    { label: "Agent since", value: "—", sub: "chain 968" },
  ];
  const statItemsFinal =
    history.length === 0
      ? statItems.slice(0, 3)
      : statItems;

  return (
    <div className="animate-fade-up mx-auto max-w-4xl space-y-5">
      <div>
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-mute transition hover:text-fg"
        >
          <ArrowLeft size={14} /> Marketplace
        </Link>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-subtle text-accent">
            <Person size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-fg">Agent profile</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm text-mute">{shortAddress(address ?? "")}</span>
              {address && (
                <>
                  <span className="h-3 w-px bg-line" />
                  <button
                    onClick={() => copyText(address)}
                    className="inline-flex items-center gap-1 text-xs text-faint transition hover:text-fg"
                  >
                    <Copy size={12} /> Copy address
                  </button>
                  <a
                    href={explorerAddress(address)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-faint transition hover:text-fg"
                  >
                    Explorer <ArrowUpRight size={12} />
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {invalid && (
        <div className="panel px-6 py-12 text-center">
          <p className="text-sm text-fg">Not a valid address.</p>
          <Link href="/" className="btn-secondary btn-sm mt-4">Back to marketplace</Link>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-subtle px-6 py-14 text-center">
          <p className="text-sm text-fg">{error}</p>
          <Link href="/" className="btn-secondary btn-sm">Back to marketplace</Link>
        </div>
      ) : !address ? null : (
        <>
          {/* Rating + completion stats */}
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-lineSoft sm:grid-cols-4">
            {statItemsFinal.map((s) => (
              <div key={s.label} className="bg-canvas px-5 py-4">
                <div className="micro">{s.label}</div>
                <div className="mt-1 text-xl font-semibold tracking-tight text-fg tnum">{s.value}</div>
                {s.sub && <div className="mt-0.5 text-[11px] text-faint">{s.sub}</div>}
              </div>
            ))}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Rating history */}
            <section className="panel p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                <Award size={15} className="text-accent" /> Rating history
              </h2>
              {ratings.length === 0 ? (
                <p className="text-[13px] text-faint">
                  No ratings yet — requesters rate agents after a release. An empty record is
                  neither good nor bad; it just means no task has settled.
                </p>
              ) : (
                <ul className="divide-y divide-lineSoft">
                  {[...ratings].reverse().map((r) => (
                    <li key={r.taskId.toString()} className="flex items-center gap-3 py-2.5">
                      <div className="flex shrink-0 gap-0.5">{stars(r.score)}</div>
                      <Link
                        href={`/task/${r.taskId}`}
                        className="min-w-0 flex-1 text-[13px] font-medium text-fg transition hover:text-accent"
                      >
                        Task #{r.taskId.toString().padStart(3, "0")}
                      </Link>
                      <span className="text-[11px] text-faint tnum">
                        {formatTimestamp(r.ratedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Work history */}
            <section className="panel p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
                <History size={15} className="text-accent" /> Work history
              </h2>
              {history.length === 0 ? (
                <p className="text-[13px] text-faint">
                  This address has not been named as an agent on any task.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.map((t) => {
                    const title =
                      taskTitle(specs[t.taskId.toString()]?.name, specs[t.taskId.toString()]?.spec_text) ||
                      `Task #${t.taskId.toString().padStart(3, "0")}`;
                    return (
                      <li key={t.taskId.toString()}>
                        <Link
                          href={`/task/${t.taskId}`}
                          className="group block rounded-lg border border-line bg-well px-3.5 py-3 transition hover:border-accent-line"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] font-medium text-fg group-hover:text-accent">
                              {title}
                            </span>
                            <StatusBadge status={t.status} pulse={isDisputeRange(t.status)} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                            <span className="font-mono tnum">
                              {formatAmount(t.amount)} BOT
                            </span>
                            <span>· created {formatTimestamp(t.createdAt)}</span>
                            {disputedIds.has(t.taskId.toString()) && (
                              <span className="inline-flex items-center gap-1 text-warn">
                                <Scale size={11} /> disputed
                              </span>
                            )}
                            <span className="ml-auto inline-flex items-center gap-1 font-medium text-accent opacity-0 transition group-hover:opacity-100">
                              View <ArrowUpRight size={11} />
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
