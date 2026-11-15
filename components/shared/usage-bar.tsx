"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

/** Linear usage progress bar with threshold coloring (primary / warning / error). */
export function UsageBar({
  label,
  valueLabel,
  percent,
  compact = false,
  sx,
}: {
  label?: string;
  valueLabel?: string;
  percent: number;
  compact?: boolean;
  sx?: SxProps<Theme>;
}) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const color: "primary" | "warning" | "error" =
    clamped >= 90 ? "error" : clamped >= 75 ? "warning" : "primary";

  return (
    <Box
      sx={[
        {
          display: "flex",
          flexDirection: "column",
          gap: compact ? 0.5 : 0.75,
          minWidth: 0,
          width: "100%",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {(label || valueLabel) && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            minWidth: 0,
          }}
        >
          {label && (
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: "var(--muted-foreground)",
                fontWeight: 500,
                fontSize: compact ? "0.7rem" : "0.75rem",
              }}
            >
              {label}
            </Typography>
          )}
          {valueLabel && (
            <Typography
              variant="caption"
              noWrap
              sx={{
                fontFamily: "var(--font-mono)",
                color: "var(--foreground)",
                fontWeight: 500,
                fontSize: compact ? "0.7rem" : "0.75rem",
              }}
            >
              {valueLabel}
            </Typography>
          )}
        </Box>
      )}
      <LinearProgress
        variant="determinate"
        value={clamped}
        color={color}
        sx={{
          height: compact ? 5 : 6,
          borderRadius: 999,
          backgroundColor: "var(--muted)",
        }}
      />
    </Box>
  );
}
