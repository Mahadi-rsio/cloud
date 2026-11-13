import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

/** A responsive definition list. Stacks label over value on narrow screens,
 * label/value side-by-side on wider screens. Rows are separated by hairlines,
 * not boxes. */
export function DataList({
  items,
  sx,
}: {
  items: { label: string; value: React.ReactNode; hint?: string }[];
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="dl"
      sx={[
        {
          m: 0,
          "& > div + div": {
            borderTop: "1px solid var(--border)",
          },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {items.map((item, index) => (
        <Box
          key={index}
          sx={{
            display: "grid",
            gap: { xs: 0.5, sm: 2 },
            py: 1.5,
            gridTemplateColumns: { xs: "1fr", sm: "minmax(9rem, 13rem) 1fr" },
          }}
        >
          <Typography
            component="dt"
            variant="body2"
            sx={{ color: "var(--muted-foreground)" }}
          >
            {item.label}
          </Typography>
          <Box
            component="dd"
            title={item.hint}
            sx={{
              m: 0,
              minWidth: 0,
              fontSize: "0.875rem",
              color: "var(--foreground)",
            }}
          >
            {item.value}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
