"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * Compact, tappable row for mobile resource lists and dense list views.
 * Displays an icon, primary/secondary two-line content, and trailing actions.
 */
export function ResourceRow({
  icon,
  primary,
  secondary,
  trailing,
  leading,
  onClick,
  selected = false,
  sx,
}: {
  icon?: React.ReactNode;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      sx={[
        {
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 1.75,
          py: 1.375,
          minWidth: 0,
          cursor: onClick ? "pointer" : "default",
          backgroundColor: selected
            ? "color-mix(in oklab, var(--primary) 10%, transparent)"
            : "transparent",
          transition: "background-color 0.12s ease",
          "&:hover": onClick
            ? {
                backgroundColor: selected
                  ? "color-mix(in oklab, var(--primary) 14%, transparent)"
                  : "var(--accent)",
              }
            : undefined,
          "&:focus-visible": onClick
            ? {
                outline: "2px solid var(--ring)",
                outlineOffset: -2,
              }
            : undefined,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {leading}
      {icon && (
        <Box
          sx={{
            display: "flex",
            width: 34,
            height: 34,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
            backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
            color: "var(--primary)",
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.375 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            minWidth: 0,
          }}
        >
          {primary}
        </Box>
        {secondary && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
              minWidth: 0,
              color: "var(--muted-foreground)",
              fontSize: "0.75rem",
            }}
          >
            {secondary}
          </Box>
        )}
      </Box>
      {trailing && (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {trailing}
        </Box>
      )}
    </Box>
  );
}
