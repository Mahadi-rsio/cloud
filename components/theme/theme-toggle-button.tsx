"use client";

import * as React from "react";
import { useEffect } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/theme-store";
import { cn } from "cn";

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
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Tooltip title={label} arrow>
      <IconButton
        size="small"
        aria-label={label}
        onClick={() => store.setTheme(dark ? "light" : "dark")}
        sx={{
          color: "var(--muted-foreground)",
          borderRadius: "8px",
          width: 36,
          height: 36,
          transition: "all 0.15s ease",
          "&:hover": {
            backgroundColor: "var(--accent)",
            color: "var(--foreground)",
          },
        }}
        className={cn("shrink-0", className)}
      >
        {dark ? <Sun className="size-4.5" /> : <Moon className="size-4.5" />}
      </IconButton>
    </Tooltip>
  );
}
