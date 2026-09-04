import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand hue (kept literal — works on both themes via alpha layering).
        iris: {
          200: "#C9C3FF",
          300: "#AEA5FF",
          400: "#9386FF",
          500: "#7A68FF",
          600: "#6B4EFF",
          700: "#5A3EEB",
          800: "#482FC4",
        },
        // Theme-aware aliases — values flip under <html class="light">.
        canvas: "var(--canvas)",
        panel: "var(--panel)",
        well: "var(--well)",
        subtle: "var(--subtle)",
        subtleH: "var(--subtle-h)",
        line: "var(--line)",
        lineH: "var(--line-h)",
        lineSoft: "var(--line-soft)",
        fg: "var(--fg)",
        mute: "var(--mute)",
        faint: "var(--faint)",
        accent: {
          DEFAULT: "var(--accent-text)",
          line: "var(--accent-line)",
          soft: "var(--accent-soft)",
          strong: "var(--accent-strong)",
        },
        ok: { DEFAULT: "var(--ok-text)", soft: "var(--ok-soft)", line: "var(--ok-line)" },
        bad: { DEFAULT: "var(--bad-text)", soft: "var(--bad-soft)", line: "var(--bad-line)" },
        warn: { DEFAULT: "var(--warn-text)", soft: "var(--warn-soft)", line: "var(--warn-line)" },
        warn2: { DEFAULT: "var(--warn2-text)", soft: "var(--warn2-soft)", line: "var(--warn2-line)" },
        info: { DEFAULT: "var(--info-text)", soft: "var(--info-soft)", line: "var(--info-line)" },
        vio: { DEFAULT: "var(--vio-text)", soft: "var(--vio-soft)", line: "var(--vio-line)" },
        fu: { DEFAULT: "var(--fu-text)", soft: "var(--fu-soft)", line: "var(--fu-line)" },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      letterSpacing: { tightest: "-0.03em" },
      boxShadow: {
        panel: "var(--shadow-panel)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-400px 0" },
          "100%": { backgroundPosition: "400px 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
