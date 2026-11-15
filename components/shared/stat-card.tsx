"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

/** Compact, dense stat card for dashboard summaries and detail pages. */
export function StatCard({
  label,
  value,
  subtext,
  icon,
  action,
  mono = false,
  sx,
}: {
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  mono?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper
      variant="outlined"
      sx={[
        {
          p: 2,
          borderRadius: "12px",
          backgroundColor: "var(--card)",
          borderColor: "var(--border)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 1,
          minWidth: 0,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography
          variant="caption"
          noWrap
          sx={{
            fontWeight: 600,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
            fontSize: "0.7rem",
          }}
        >
          {label}
        </Typography>
        {icon && (
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: "7px",
              backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
              color: "var(--primary)",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            minWidth: 0,
            flex: 1,
            fontFamily: mono ? "var(--font-mono)" : "inherit",
            fontWeight: 600,
            fontSize: "1.125rem",
            lineHeight: 1.3,
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </Box>
        {action}
      </Box>

      {subtext && (
        <Typography
          variant="caption"
          sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem", lineHeight: 1.4 }}
        >
          {subtext}
        </Typography>
      )}
    </Paper>
  );
}
