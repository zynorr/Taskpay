"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "./ConnectButton";

export default function SiteHeader() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Marketplace" },
    { href: "/create", label: "Create task" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 shadow-glow-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path
                d="m8.5 12 2.5 2.5 4.5-5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-100">
            TaskPay
            <span className="text-brand-400">.</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-slate-800/80 text-white shadow-card"
                    : "text-slate-400 hover:bg-slate-800/40 hover:text-slate-200"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <span className="mx-1 h-5 w-px bg-slate-800" />
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}