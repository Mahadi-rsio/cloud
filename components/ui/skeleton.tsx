"use client";

import * as React from "react";
import MuiSkeleton from "@mui/material/Skeleton";
import { cn } from "cn";

export function Skeleton({
  className,
  variant = "rounded",
  animation = "wave",
  ...props
}: {
  className?: string;
  variant?: "circular" | "rectangular" | "rounded" | "text";
  animation?: "pulse" | "wave" | false;
  [key: string]: any;
}) {
  return (
    <MuiSkeleton
      variant={variant}
      animation={animation}
      sx={{
        backgroundColor: "var(--muted)",
        "&::after": {
          background:
            "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)",
        },
      }}
      className={cn("rounded-lg", className)}
      {...props}
    />
  );
}
