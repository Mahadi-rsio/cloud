"use client";

import * as React from "react";
import { Database, HardDrive, ArrowDownToLine, ArrowUpToLine, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, type StorageUsageResponse } from "@/lib/storage-client";
import { cn } from "cn";

export function QuotaMeterBar({
  usage,
  isLoading = false,
}: {
  usage: StorageUsageResponse | null;
  isLoading?: boolean;
}) {
  const usedBytes = usage?.usedBytes ?? 0;
  const storageLimitBytes = usage?.storageLimitBytes ?? 536_870_912; // 512 MB
  const storagePercent = Math.min(
    100,
    storageLimitBytes > 0 ? (usedBytes / storageLimitBytes) * 100 : 0
  );

  const readOps = usage?.monthlyReadOps ?? 0;
  const readLimit = usage?.monthlyReadLimitOps ?? 100_000;
  const readPercent = Math.min(100, readLimit > 0 ? (readOps / readLimit) * 100 : 0);

  const writeOps = usage?.monthlyWriteOps ?? 0;
  const writeLimit = usage?.monthlyWriteLimitOps ?? 100_000;
  const writePercent = Math.min(100, writeLimit > 0 ? (writeOps / writeLimit) * 100 : 0);

  const fileCount = usage?.fileCount ?? 0;

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return "bg-destructive";
    if (percent >= 75) return "bg-amber-500";
    return "bg-primary";
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Storage Capacity */}
      <Card className="p-4 py-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Storage Capacity
          </span>
          <HardDrive className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {isLoading ? "—" : formatBytes(usedBytes)}
            </span>
            <span className="text-xs text-muted-foreground">
              of {formatBytes(storageLimitBytes)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all duration-300", getProgressColor(storagePercent))}
              style={{ width: `${Math.max(2, storagePercent)}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isLoading ? "..." : `${storagePercent.toFixed(1)}% free tier used`}
          </span>
        </div>
      </Card>

      {/* Monthly Reads */}
      <Card className="p-4 py-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Monthly Reads (Class B)
          </span>
          <ArrowDownToLine className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {isLoading ? "—" : readOps.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              of {readLimit.toLocaleString()} ops
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all duration-300", getProgressColor(readPercent))}
              style={{ width: `${Math.max(2, readPercent)}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isLoading ? "..." : `${(100 - readPercent).toFixed(1)}% allowance remaining`}
          </span>
        </div>
      </Card>

      {/* Monthly Writes */}
      <Card className="p-4 py-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Monthly Writes (Class A)
          </span>
          <ArrowUpToLine className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {isLoading ? "—" : writeOps.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">
              of {writeLimit.toLocaleString()} ops
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full transition-all duration-300", getProgressColor(writePercent))}
              style={{ width: `${Math.max(2, writePercent)}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isLoading ? "..." : `${(100 - writePercent).toFixed(1)}% allowance remaining`}
          </span>
        </div>
      </Card>

      {/* Total Objects */}
      <Card className="p-4 py-4 gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Stored Objects
          </span>
          <FileText className="size-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {isLoading ? "—" : fileCount.toLocaleString()}
            </span>
            <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {usage?.plan?.toUpperCase() || "FREE"}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground pt-1.5">
            Real-time Durable Object atomic tracking
          </p>
        </div>
      </Card>
    </div>
  );
}
