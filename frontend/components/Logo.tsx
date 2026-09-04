import Link from "next/link";

/** Escrow mark: a coin with a settled check inside a gradient tile. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="relative inline-flex shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-iris-500 via-iris-600 to-iris-800 shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_4px_14px_-4px_rgba(107,78,255,0.7)]"
    >
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle
          cx="12"
          cy="12"
          r="8.6"
          stroke="white"
          strokeWidth="2.1"
          strokeLinecap="round"
          opacity="0.96"
        />
        <path
          d="m8.2 12.2 2.4 2.5 5.2-5.6"
          stroke="white"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight text-white">
        Task<span className="text-zinc-500">Pay</span>
      </span>
    </Link>
  );
}
