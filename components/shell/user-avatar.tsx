"use client";

import * as React from "react";
import Avatar from "@mui/material/Avatar";
import type { SxProps, Theme } from "@mui/material/styles";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

export function UserAvatar({
  name,
  src,
  sx,
  size = 32,
}: {
  name: string;
  src?: string;
  sx?: SxProps<Theme>;
  size?: number;
}) {
  return (
    <Avatar
      src={src}
      alt={name}
      sx={[
        {
          width: size,
          height: size,
          flexShrink: 0,
          fontSize: size <= 32 ? "0.75rem" : "0.875rem",
          fontWeight: 600,
          backgroundColor: "var(--accent)",
          color: "var(--foreground)",
          border: "1.5px solid var(--border)",
          transition: "transform 0.15s ease",
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {initials(name)}
    </Avatar>
  );
}
