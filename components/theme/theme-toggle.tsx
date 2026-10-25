"use client";

import { useEffect } from "react";
import { Switch } from "radix-ui";
import { useThemeStore } from "@/stores/theme-store";

export function ThemeToggle({ className }: { className?: string }) {
  const store = useThemeStore();

  useEffect(() => {
    store.init();
  }, []);

  const dark = store.theme === "dark";

  return (
    <Switch.Root
      aria-label="Toggle dark mode"
      checked={dark}
      onCheckedChange={(checked) =>
        store.setTheme(checked ? "dark" : "light")
      }
      className={
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border bg-input shadow-xs transition-colors outline-none data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:pointer-events-none disabled:opacity-50 " +
        (className ?? "")
      }
    >
      <Switch.Thumb className="pointer-events-none size-4 translate-x-0 rounded-full bg-primary-foreground shadow-sm transition-transform data-[state=checked]:translate-x-4" />
    </Switch.Root>
  );
}