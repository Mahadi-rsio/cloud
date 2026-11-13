"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import type { SxProps, Theme } from "@mui/material/styles";

export type Tone = "success" | "warning" | "danger" | "muted" | "info";

const TONE_STYLES: Record<
  Tone,
  { color: string; bg: string; border: string; pulse?: boolean }
> = {
  success: {
    color: "#3dd68c",
    bg: "rgba(61, 214, 140, 0.12)",
    border: "rgba(61, 214, 140, 0.3)",
  },
  warning: {
    color: "#f5a524",
    bg: "rgba(245, 165, 36, 0.12)",
    border: "rgba(245, 165, 36, 0.3)",
    pulse: true,
  },
  danger: {
    color: "#e5484d",
    bg: "rgba(229, 72, 77, 0.12)",
    border: "rgba(229, 72, 77, 0.3)",
  },
  info: {
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.12)",
    border: "rgba(56, 189, 248, 0.3)",
    pulse: true,
  },
  muted: {
    color: "var(--muted-foreground)",
    bg: "var(--muted)",
    border: "var(--border)",
  },
};

const STATUS_TONE: Record<string, Tone> = {
  ready: "success",
  running: "success",
  active: "success",
  started: "success",
  created: "success",
  provisioning: "warning",
  pending: "warning",
  starting: "warning",
  restarting: "warning",
  redeploying: "warning",
  stopping: "warning",
  queued: "muted",
  preparing: "warning",
  building: "info",
  pushing: "info",
  deploying: "info",
  cancelled: "muted",
  failed: "danger",
  error: "danger",
  stopped: "muted",
  deleting: "muted",
  deleted: "muted",
  destroying: "muted",
  destroyed: "muted",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "muted";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** Status is communicated with a dot AND text, using an MUI pill chip. */
export function StatusBadge({
  status,
  sx,
  size = "small",
}: {
  status: string;
  sx?: SxProps<Theme>;
  size?: "small" | "medium";
}) {
  const tone = statusTone(status);
  const style = TONE_STYLES[tone];

  return (
    <Chip
      size={size}
      variant="outlined"
      icon={
        <Box
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            ml: 0.75,
            flexShrink: 0,
            backgroundColor: style.color,
            ...(style.pulse ? { animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" } : {}),
          }}
        />
      }
      label={
        <Box
          component="span"
          sx={{
            textTransform: "capitalize",
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          {statusLabel(status)}
        </Box>
      }
      sx={[
        {
          height: size === "small" ? 22 : 26,
          fontSize: "0.7rem",
          borderRadius: "9999px",
          color: style.color,
          backgroundColor: style.bg,
          borderColor: style.border,
          "& .MuiChip-icon": {
            marginLeft: "6px",
            marginRight: "-4px",
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
