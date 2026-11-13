"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

export function EmptyState({
  icon,
  title,
  description,
  action,
  sx,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper
      variant="outlined"
      sx={[
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.75,
          borderRadius: "16px",
          borderStyle: "dashed",
          borderColor: "var(--border)",
          px: 3,
          py: { xs: 6, sm: 8 },
          textAlign: "center",
          backgroundColor: "var(--card)",
          backgroundImage:
            "radial-gradient(ellipse at center, rgba(56, 189, 248, 0.03), transparent 70%)",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {icon && (
        <Box
          sx={{
            display: "inline-flex",
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "12px",
            backgroundColor: "var(--muted)",
            color: "var(--primary)",
            border: "1px solid var(--border)",
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxWidth: "28rem" }}>
        <Typography
          variant="h6"
          component="h3"
          sx={{ fontWeight: 600, color: "var(--foreground)", fontSize: "1rem" }}
        >
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            sx={{ color: "var(--muted-foreground)", lineHeight: 1.5 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Paper>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  sx,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper
      variant="outlined"
      sx={[
        {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          borderRadius: "16px",
          borderColor: "rgba(229, 72, 77, 0.35)",
          backgroundColor: "rgba(229, 72, 77, 0.06)",
          px: 3,
          py: { xs: 6, sm: 7 },
          textAlign: "center",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxWidth: "28rem" }}>
        <Typography
          variant="h6"
          component="h3"
          sx={{ fontWeight: 600, color: "var(--foreground)", fontSize: "1rem" }}
        >
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            sx={{ color: "var(--muted-foreground)", lineHeight: 1.5 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      {onRetry && (
        <Button type="button" variant="outlined" size="small" onClick={onRetry} sx={{ mt: 0.5 }}>
          Try again
        </Button>
      )}
    </Paper>
  );
}
