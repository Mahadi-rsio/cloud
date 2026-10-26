"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/theme-store";

/** Icon-only theme toggle for the top bar. */
export function ThemeToggleButton({
  className,
}: {
  className?: string;
}) {
  const store = useThemeStore();

  useEffect(() => {
    store.init();
  }, []);

  const dark = store.theme === "dark";

  return (
    <button
      type="button"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
        (className ?? "")
      }
      onClick={() => store.setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
    </button>
  );
}