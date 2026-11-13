"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { SxProps, Theme } from "@mui/material/styles";

export function PageHeader({
  title,
  description,
  actions,
  sx,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      sx={[
        {
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "flex-start" },
          justifyContent: { sm: "space-between" },
          gap: 2,
          pb: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box sx={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 0.75 }}>
        <Typography
          variant="h5"
          component="h1"
          sx={{
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--foreground)",
            fontSize: { xs: "1.375rem", sm: "1.625rem" },
          }}
        >
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            sx={{
              color: "var(--muted-foreground)",
              maxWidth: "48rem",
              fontSize: { xs: "0.84rem", sm: "0.875rem" },
              lineHeight: 1.5,
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {actions && (
        <Stack
          direction="row"
          spacing={1.5}
          useFlexGap
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            flexShrink: 0,
            pt: { xs: 0.5, sm: 0 },
          }}
        >
          {actions}
        </Stack>
      )}
    </Box>
  );
}
