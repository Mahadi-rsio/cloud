"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import type { SxProps, Theme } from "@mui/material/styles";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Equal-width segmented control with 4px inner padding, 12px container radius,
 * 8px active pill radius, and smooth 150ms transition.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel = "View switcher",
  sx,
}: {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      role="tablist"
      aria-label={ariaLabel}
      sx={[
        {
          display: "flex",
          alignItems: "center",
          gap: "4px",
          p: "4px",
          borderRadius: "12px",
          border: "1px solid var(--border)",
          bgcolor: "var(--background)",
          minHeight: 44,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <ButtonBase
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            sx={{
              flex: 1,
              minHeight: 36,
              height: 36,
              px: 1.5,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              fontFamily: "inherit",
              bgcolor: active ? "var(--primary)" : "transparent",
              color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
              transition: "background-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
              "&:hover": {
                bgcolor: active ? "var(--primary)" : "var(--accent)",
                color: active ? "var(--primary-foreground)" : "var(--foreground)",
              },
              "&:focus-visible": {
                outline: "2px solid var(--ring)",
                outlineOffset: 1,
              },
            }}
          >
            {opt.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
