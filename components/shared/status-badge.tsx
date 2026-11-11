"use client";

import * as React from "react";
import Chip from "@mui/material/Chip";
import { cn } from "cn";

export type Tone = "success" | "warning" | "danger" | "muted" | "info";

const TONE_CLASSES: Record<Tone, { chip: string; dot: string; pulse?: boolean }> = {
  success: {
    chip: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/25 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  warning: {
    chip: "bg-amber-500/10 text-amber-600 border border-amber-500/25 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30",
    dot: "bg-amber-500 dark:bg-amber-400",
    pulse: true,
  },
  danger: {
    chip: "bg-rose-500/10 text-rose-600 border border-rose-500/25 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
  info: {
    chip: "bg-sky-500/10 text-sky-600 border border-sky-500/25 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30",
    dot: "bg-sky-500 dark:bg-sky-400",
    pulse: true,
  },
  muted: {
    chip: "bg-muted text-muted-foreground border border-border",
    dot: "bg-muted-foreground",
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

/** Status is communicated with a dot AND text, enhanced with an MUI-styled pill chip. */
export function StatusBadge({
  status,
  className,
  size = "small",
}: {
  status: string;
  className?: string;
  size?: "small" | "medium";
}) {
  const tone = statusTone(status);
  const styles = TONE_CLASSES[tone];

  return (
    <Chip
      size={size}
      variant="outlined"
      icon={
        <span
          className={cn(
            "size-1.5 rounded-full ml-1.5 shrink-0",
            styles.dot,
            styles.pulse && "animate-pulse"
          )}
        />
      }
      label={
        <span className="capitalize font-semibold tracking-wide">
          {statusLabel(status)}
        </span>
      }
      className={cn(
        "h-6 px-1 text-xs font-medium rounded-full transition-colors",
        styles.chip,
        className
      )}
      sx={{
        borderColor: "inherit",
        "& .MuiChip-label": {
          paddingLeft: "6px",
          paddingRight: "8px",
        },
      }}
    />
  );
}
