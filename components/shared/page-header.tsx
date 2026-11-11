"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { cn } from "cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <Box
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pb-2 border-b border-border/40",
        className
      )}
    >
      <Box className="flex min-w-0 flex-col gap-1.5">
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
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          className="shrink-0 pt-1 sm:pt-0"
        >
          {actions}
        </Stack>
      )}
    </Box>
  );
}
