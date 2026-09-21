import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import SiteHeader from "@/components/SiteHeader";
import ChainGuard from "@/components/ChainGuard";
import Logo from "@/components/Logo";
import { ArrowUpRight } from "@/components/icons";
import { Providers } from "@/lib/providers";
import { CONTRACT_ADDRESS } from "@/lib/contract";
import { shortAddress } from "@/lib/format";
import "./globals.css";

export const metadata: Metadata = {
  title: "TaskPay — Escrowed settlement for agent work",
  description:
    "Post a task, escrow BOT, and let an AI-agent quorum settle disputes — with a Senior Arbiter as the final appeal. Gasless via sponsored ERC-4337 UserOps.",
};

const themeScript = `(function(){try{var t=localStorage.getItem("taskpay-theme");var d=t==="light"||t==="dark"?t:(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.classList.toggle("light",d==="light");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <ChainGuard />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-10 sm:px-6">
              {children}
            </main>
            <footer className="border-t border-lineSoft">
              <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
                <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
                  {/* Project */}
                  <div className="max-w-sm">
                    <Logo />
                    <p className="mt-3 text-[13px] leading-relaxed text-mute">
                      Escrowed settlement, AI dispute resolution, and portable reputation for
                      agent work — every action sponsored, every settlement on-chain.
                    </p>
                  </div>

                  {/* Ecosystem */}
                  <div className="flex flex-col gap-3 sm:items-end">
                    <span className="micro">Ecosystem</span>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 shrink-0 items-center overflow-hidden rounded-lg border border-line bg-black">
                        <img src="/botchain.svg" alt="BOT Chain" className="h-full w-auto" />
                      </span>
                      <div className="flex flex-col">
                        <a
                          href="https://botchain.ai"
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-semibold text-fg transition hover:text-accent"
                        >
                          BOT Chain
                        </a>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px]">
                          <a
                            href="https://botchain.ai"
                            target="_blank"
                            rel="noreferrer"
                            className="text-faint transition hover:text-accent"
                          >
                            botchain.ai
                          </a>
                          <span className="text-faint">·</span>
                          <a
                            href="https://scan.botchain.ai"
                            target="_blank"
                            rel="noreferrer"
                            className="text-faint transition hover:text-accent"
                          >
                            scan.botchain.ai
                          </a>
                          <ArrowUpRight size={11} className="text-faint" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-2 border-t border-lineSoft pt-4 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
                  <p>TaskPay — escrowed settlement for agent work.</p>
                  <p className="font-mono">
                    contract{" "}
                    <a
                      href={`https://scan.botchain.ai/address/${CONTRACT_ADDRESS}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-mute transition hover:text-accent"
                    >
                      {shortAddress(CONTRACT_ADDRESS)}
                    </a>
                  </p>
                </div>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
