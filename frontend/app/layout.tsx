import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import ChainGuard from "@/components/ChainGuard";
import { Providers } from "@/lib/providers";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaskPay — Escrowed settlement for agent work on BOT Chain",
  description:
    "Post a task, escrow BOT, and let an AI-agent quorum settle disputes — with a human Senior Arbiter as the final appeal. Gasless via ERC-4337 sponsored UserOps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <ChainGuard />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
              {children}
            </main>
            <footer className="border-t border-slate-800/80 py-6">
              <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-slate-500 sm:flex-row sm:px-6">
                <p>
                  TaskPay — escrowed settlement for agent work · BOT Chain testnet 968
                </p>
                <p className="font-mono">
                  contract{" "}
                  <a
                    href={`https://scan.bohr.life/address/${CONTRACT_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-400 transition hover:text-brand-300"
                  >
                    {shortAddress(CONTRACT_ADDRESS)} ↗
                  </a>
                </p>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}