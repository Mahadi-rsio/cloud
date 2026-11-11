"use client";

import * as React from "react";
import { HardDrive, ArrowDownToLine, ArrowUpToLine, FileText } from "lucide-react";
import LinearProgress from "@mui/material/LinearProgress";
import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Card } from "@/components/ui/card";
import { formatBytes, type StorageUsageResponse } from "@/lib/storage-client";

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

  const getLinearColor = (percent: number) => {
    if (percent >= 90) return "error";
    if (percent >= 75) return "warning";
    return "primary";
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Storage Capacity */}
      <Card hoverable className="p-4 sm:p-5 gap-3.5">
        <div className="flex items-center justify-between">
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
            }}
          >
            Storage Capacity
          </Typography>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HardDrive className="size-4" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, color: "var(--foreground)" }}
            >
              {isLoading ? "—" : formatBytes(usedBytes)}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "var(--muted-foreground)" }}
            >
              of {formatBytes(storageLimitBytes)}
            </Typography>
          </div>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, storagePercent)}
            color={getLinearColor(storagePercent)}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "var(--muted)",
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}
          >
            {isLoading ? "Loading..." : `${storagePercent.toFixed(1)}% free tier used`}
          </Typography>
        </div>
      </Card>

      {/* Monthly Reads */}
      <Card hoverable className="p-4 sm:p-5 gap-3.5">
        <div className="flex items-center justify-between">
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
            }}
          >
            Monthly Reads
          </Typography>
          <div className="flex size-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
            <ArrowDownToLine className="size-4" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, color: "var(--foreground)" }}
            >
              {isLoading ? "—" : readOps.toLocaleString()}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "var(--muted-foreground)" }}
            >
              of {readLimit.toLocaleString()} ops
            </Typography>
          </div>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, readPercent)}
            color={getLinearColor(readPercent)}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "var(--muted)",
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}
          >
            {isLoading ? "Loading..." : `${(100 - readPercent).toFixed(1)}% remaining`}
          </Typography>
        </div>
      </Card>

      {/* Monthly Writes */}
      <Card hoverable className="p-4 sm:p-5 gap-3.5">
        <div className="flex items-center justify-between">
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
            }}
          >
            Monthly Writes
          </Typography>
          <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <ArrowUpToLine className="size-4" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, color: "var(--foreground)" }}
            >
              {isLoading ? "—" : writeOps.toLocaleString()}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: "var(--muted-foreground)" }}
            >
              of {writeLimit.toLocaleString()} ops
            </Typography>
          </div>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, writePercent)}
            color={getLinearColor(writePercent)}
            sx={{
              height: 6,
              borderRadius: 3,
              backgroundColor: "var(--muted)",
            }}
          />
          <Typography
            variant="caption"
            sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}
          >
            {isLoading ? "Loading..." : `${(100 - writePercent).toFixed(1)}% remaining`}
          </Typography>
        </div>
      </Card>

      {/* Total Objects */}
      <Card hoverable className="p-4 sm:p-5 gap-3.5">
        <div className="flex items-center justify-between">
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
            }}
          >
            Stored Objects
          </Typography>
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
            <FileText className="size-4" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Typography
              variant="h5"
              sx={{ fontWeight: 700, color: "var(--foreground)" }}
            >
              {isLoading ? "—" : fileCount.toLocaleString()}
            </Typography>
            <Chip
              label={usage?.plan?.toUpperCase() || "FREE TIER"}
              size="small"
              sx={{
                height: 22,
                fontSize: "0.6875rem",
                fontWeight: 700,
                backgroundColor: "rgba(56, 189, 248, 0.12)",
                color: "var(--primary)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
              }}
            />
          </div>
          <Box sx={{ pt: 1 }}>
            <Typography
              variant="caption"
              sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem", display: "block" }}
            >
              Real-time Durable Object storage & tracking
            </Typography>
          </Box>
        </div>
      </Card>
    </div>
  );
}
