"use client";

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, strokeWidth = 1.8, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

export const ArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

export const ArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const ArrowUpRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </svg>
);

export const Check = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const Copy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const ChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const Clock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const ShieldCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);

export const Bolt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z" />
  </svg>
);

export const Star = (p: IconProps) => (
  <svg {...base(p)} fill="currentColor" strokeWidth={0}>
    <path d="M12 2.8 14.9 8.6l6.4.9-4.6 4.5 1.1 6.3L12 17.4l-5.7 3 1.1-6.3L2.7 9.5l6.4-.9L12 2.8Z" />
  </svg>
);

export const Info = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 7.6v.4" />
  </svg>
);

export const AlertTriangle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10.3 4.2 2.6 17.6a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5V14" />
    <path d="M12 17v.4" />
  </svg>
);

export const Refresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 3v4h-4" />
  </svg>
);

export const Scale = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3v18" />
    <path d="M7 21h10" />
    <path d="M5 7h14" />
    <path d="M5 7 3.5 13a3 3 0 0 0 5 0L7 7" />
    <path d="m19 7-1.5 6a3 3 0 0 0 5 0L21 7" />
    <path d="M9 7a3 3 0 0 1 6 0" />
  </svg>
);

export const FileText = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h6" />
  </svg>
);

export const Wallet = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5" />
    <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
    <path d="M16.5 13.5h.5" />
  </svg>
);

export const Package = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 2 8 4.5v11L12 22l-8-4.5v-11L12 2Z" />
    <path d="M4 6.5 12 11l8-4.5" />
    <path d="M12 11v11" />
  </svg>
);

export const Sun = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5" />
    <path d="M12 19v2.5" />
    <path d="M4.9 4.9l1.8 1.8" />
    <path d="M17.3 17.3l1.8 1.8" />
    <path d="M2.5 12H5" />
    <path d="M19 12h2.5" />
    <path d="m4.9 19.1 1.8-1.8" />
    <path d="m17.3 6.7 1.8-1.8" />
  </svg>
);

export const Moon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
  </svg>
);
