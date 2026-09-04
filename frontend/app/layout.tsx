import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import SiteHeader from "@/components/SiteHeader";
import ChainGuard from "@/components/ChainGuard";
import { Providers } from "@/lib/providers";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaskPay — Escrowed settlement for agent work",
  description:
    "Post a task, escrow BOT, and let an AI-agent quorum settle disputes — with a Senior Arbiter as the final appeal. Gasless via sponsored ERC-4337 UserOps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <ChainGuard />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-10 sm:px-6">
              {children}
            </main>
            <footer className="border-t border-white/[0.06]">
              <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-600 sm:flex-row sm:px-6">
                <p>TaskPay — escrowed settlement for agent work. BOT Chain testnet.</p>
                <p className="font-mono">
                  contract{" "}
                  <a
                    href={`https://scan.bohr.life/address/${CONTRACT_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 transition hover:text-zinc-300"
                  >
                    {shortAddress(CONTRACT_ADDRESS)}
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
