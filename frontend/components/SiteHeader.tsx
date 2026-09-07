"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import ConnectButton from "./ConnectButton";
import ThemeToggle from "./ThemeToggle";

export default function SiteHeader() {
  const pathname = usePathname();

  const links = [{ href: "/", label: "Marketplace" }];

  return (
    <header className="sticky top-0 z-40 border-b border-lineSoft bg-canvas backdrop-blur-md">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <Logo />

        <nav className="ml-auto flex items-center gap-5 text-sm sm:ml-0">
          <div className="hidden items-center gap-5 sm:flex">
            {links.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative py-1 transition ${
                    active ? "text-fg" : "text-mute hover:text-fg"
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
            <ThemeToggle />
            <ConnectButton />
          </div>
        </nav>
      </div>
    </header>
  );
}
