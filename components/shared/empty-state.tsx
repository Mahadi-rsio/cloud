"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Paper
      variant="outlined"
      className={cn(
        "flex flex-col items-center justify-center gap-3.5 rounded-2xl border-dashed border-border/80 px-6 py-12 sm:py-16 text-center bg-card/40 transition-colors",
        className
      )}
      sx={{
        backgroundImage:
          "radial-gradient(ellipse at center, rgba(56, 189, 248, 0.03), transparent 70%)",
      }}
    >
      {icon && (
        <Box className="inline-flex size-12 items-center justify-center rounded-xl bg-muted/70 text-primary border border-border/60 shadow-xs">
          {icon}
        </Box>
      )}
      <Box className="flex flex-col gap-1 max-w-md">
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
      {action && <Box className="mt-2">{action}</Box>}
    </Paper>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Paper
      variant="outlined"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-destructive/30 bg-destructive/5 px-6 py-12 sm:py-14 text-center",
        className
      )}
    >
      <Box className="flex flex-col gap-1 max-w-md">
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
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          className="mt-1"
        >
          Try again
        </Button>
      )}
    </Paper>
  );
}
