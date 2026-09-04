"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "./icons";

const KEY = "taskpay-theme";

function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    let initial: "dark" | "light" = "dark";
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") initial = saved;
    } catch {
      /* ignore */
    }
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-subtle text-mute transition hover:border-lineH hover:text-fg"
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
