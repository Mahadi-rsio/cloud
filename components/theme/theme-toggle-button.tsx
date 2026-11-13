"use client";

import * as React from "react";
import { useEffect } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";
import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/theme-store";

export function ThemeToggleButton({ sx }: { sx?: SxProps<Theme> }) {
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
        sx={[
          {
            flexShrink: 0,
            color: "var(--muted-foreground)",
            borderRadius: "8px",
            width: 36,
            height: 36,
            transition: "all 0.15s ease",
            "&:hover": {
              backgroundColor: "var(--accent)",
              color: "var(--foreground)",
            },
          },
          ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
        ]}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </IconButton>
    </Tooltip>
  );
}
