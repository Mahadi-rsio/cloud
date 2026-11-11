"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import { cn } from "cn";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserAvatar({
  name,
  src,
  className,
  size = 32,
}: {
  name: string;
  src?: string;
  className?: string;
  size?: number;
}) {
  return (
    <Avatar
      src={src}
      alt={name}
      sx={{
        width: size,
        height: size,
        fontSize: size <= 32 ? "0.75rem" : "0.875rem",
        fontWeight: 600,
        backgroundColor: "var(--accent)",
        color: "var(--foreground)",
        border: "1.5px solid var(--border)",
      }}
      className={cn("shrink-0 transition-transform", className)}
    >
      {initials(name)}
    </Avatar>
  );
}
