"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/components/apps/format";

/** Renders a relative time that re-renders every 30 seconds so it stays fresh. */
export function RelativeTime({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={className} title={value ? new Date(value).toLocaleString() : undefined}>
      {formatRelativeTime(value, now)}
    </span>
  );
}