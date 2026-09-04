"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import ConnectButton from "./ConnectButton";

export default function SiteHeader() {
  const pathname = usePathname();

  const links = [{ href: "/", label: "Marketplace" }];

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />

        <nav className="flex items-center gap-6 text-sm">
          <div className="hidden items-center gap-5 sm:flex">
            {links.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative py-1 transition ${
                    active ? "text-white" : "text-zinc-500 hover:text-zinc-200"
                  }`}
                >
                  {l.label}
                  {active && (
                    <span className="absolute inset-x-0 -bottom-px h-px rounded-full bg-iris-500" />
                  )}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-2.5">
            <Link href="/create" className="btn-primary btn-sm !py-2">
              Post a task
            </Link>
            <ConnectButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
