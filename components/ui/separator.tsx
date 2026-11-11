"use client";

import * as React from "react";
import Divider from "@mui/material/Divider";
import { cn } from "cn";

export function Separator({
  className,
  orientation = "horizontal",
  flexItem,
  ...props
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
  flexItem?: boolean;
  [key: string]: any;
}) {
  return (
    <Divider
      orientation={orientation}
      flexItem={flexItem}
      sx={{
        borderColor: "var(--border)",
      }}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
