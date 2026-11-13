"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button, { type ButtonProps } from "@mui/material/Button";
import Card, { type CardProps } from "@mui/material/Card";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * Consistent surface card: 16px padding, 16px radius, 1px subtle border,
 * background one step lighter than the page, no nested border-in-border look.
 */
export function SurfaceCard({ children, sx, ...props }: CardProps) {
  return (
    <Card
      {...props}
      sx={[
        {
          p: 2,
          borderRadius: "16px",
          border: "1px solid var(--border)",
          bgcolor: "var(--card)",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Card>
  );
}

export type BadgeTone = "primary" | "success" | "warning" | "danger" | "muted";

const BADGE_STYLES: Record<BadgeTone, { color: string; bg: string; border: string }> = {
  primary: {
    color: "var(--primary)",
    bg: "color-mix(in oklab, var(--primary) 14%, transparent)",
    border: "color-mix(in oklab, var(--primary) 30%, transparent)",
  },
  success: {
    color: "var(--success)",
    bg: "color-mix(in oklab, var(--success) 14%, transparent)",
    border: "color-mix(in oklab, var(--success) 30%, transparent)",
  },
  warning: {
    color: "var(--warning)",
    bg: "color-mix(in oklab, var(--warning) 14%, transparent)",
    border: "color-mix(in oklab, var(--warning) 30%, transparent)",
  },
  danger: {
    color: "var(--destructive)",
    bg: "color-mix(in oklab, var(--destructive) 14%, transparent)",
    border: "color-mix(in oklab, var(--destructive) 30%, transparent)",
  },
  muted: {
    color: "var(--muted-foreground)",
    bg: "var(--muted)",
    border: "var(--border)",
  },
};

/** Compact non-wrapping badge pill with consistent color tones. */
export function ToneBadge({
  children,
  tone = "muted",
  icon,
  mono = false,
  sx,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  mono?: boolean;
  sx?: SxProps<Theme>;
}) {
  const styles = BADGE_STYLES[tone];
  return (
    <Box
      component="span"
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.25,
          minHeight: 22,
          borderRadius: "8px",
          border: `1px solid ${styles.border}`,
          bgcolor: styles.bg,
          color: styles.color,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {icon}
      {children}
    </Box>
  );
}

/** Accessible non-wrapping action button with consistent 44px touch height by default. */
export function ActionButton({ sx, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      sx={[
        {
          minHeight: 44,
          height: 44,
          borderRadius: "10px",
          whiteSpace: "nowrap",
          fontWeight: 600,
          fontSize: 13,
          px: 1.5,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  );
}
