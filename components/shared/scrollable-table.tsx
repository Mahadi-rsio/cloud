"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * Horizontally & vertically scrollable table wrapper with sticky header support,
 * visible thin scrollbars, and a subtle right-edge scroll hint.
 */
export function ScrollableTable({
  children,
  minWidth = 560,
  maxHeight,
  sx,
}: {
  children: React.ReactNode;
  minWidth?: number | string;
  maxHeight?: number | string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      sx={[
        {
          position: "relative",
          width: "100%",
          overflowX: "auto",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          maxHeight: maxHeight ?? "none",
          scrollbarWidth: "thin",
          "&::-webkit-scrollbar": {
            width: 6,
            height: 6,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "color-mix(in oklab, var(--muted-foreground) 35%, transparent)",
            borderRadius: "999px",
          },
          // Subtle right-edge fade hint for horizontal scrollability on narrow screens
          maskImage:
            "linear-gradient(to right, black calc(100% - 14px), rgba(0, 0, 0, 0.85) 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, black calc(100% - 14px), rgba(0, 0, 0, 0.85) 100%)",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Table
        size="small"
        stickyHeader
        sx={{
          minWidth,
          "& .MuiTableCell-stickyHeader": {
            backgroundColor: "var(--card)",
            borderBottom: "1px solid var(--border)",
            zIndex: 2,
          },
          "& .MuiTableCell-root": {
            whiteSpace: "nowrap",
            borderColor: "var(--border)",
          },
        }}
      >
        {children}
      </Table>
    </Box>
  );
}
