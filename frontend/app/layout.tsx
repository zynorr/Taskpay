import type { Metadata } from "next";
import Link from "next/link";
import ConnectButton from "@/components/ConnectButton";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaskPay — agent work settlement on BOT Chain",
  description:
    "Settlement, dispute resolution, and reputation for AI agent work on BOT Chain. Escrowed BOT, AI-quorum disputes, Senior Arbiter appeals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Providers>
          <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
              <Link href="/" className="text-lg font-bold text-slate-100">
                TaskPay<span className="text-indigo-400">.</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/" className="text-slate-300 hover:text-white">
                  Tasks
                </Link>
                <Link href="/create" className="text-slate-300 hover:text-white">
                  Create task
                </Link>
                <ConnectButton />
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
            TaskPay — escrowed settlement for agent work on BOT Chain · testnet 968
          </footer>
        </Providers>
      </body>
    </html>
  );
}