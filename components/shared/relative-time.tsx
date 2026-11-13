"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { formatRelativeTime } from "@/components/apps/format";

/** Renders a relative time that re-renders every 30 seconds so it stays fresh. */
export function RelativeTime({
  value,
  date,
  sx,
}: {
  value?: string | null | undefined;
  date?: string | null | undefined;
  sx?: SxProps<Theme>;
}) {
  const [now, setNow] = useState(() => new Date());
  const actualValue = value ?? date;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <Box
      component="span"
      sx={sx}
      title={actualValue ? new Date(actualValue).toLocaleString() : undefined}
    >
      {formatRelativeTime(actualValue, now)}
    </Box>
  );
}
