"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { HardDrive, ArrowDownToLine, ArrowUpToLine, FileText } from "lucide-react";
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
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" },
        gap: 2,
      }}
    >
      {/* Storage Capacity */}
      <Card
        sx={{
          p: { xs: 2, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          gap: 1.75,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <HardDrive size={16} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "var(--foreground)" }}>
              {isLoading ? "—" : formatBytes(usedBytes)}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {formatBytes(storageLimitBytes)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, storagePercent)}
            color={getLinearColor(storagePercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
            {isLoading ? "Loading..." : `${storagePercent.toFixed(1)}% free tier used`}
          </Typography>
        </Box>
      </Card>

      {/* Monthly Reads */}
      <Card
        sx={{
          p: { xs: 2, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          gap: 1.75,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(14, 165, 233, 0.12)",
              color: "#0ea5e9",
            }}
          >
            <ArrowDownToLine size={16} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "var(--foreground)" }}>
              {isLoading ? "—" : readOps.toLocaleString()}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {readLimit.toLocaleString()} ops
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, readPercent)}
            color={getLinearColor(readPercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
            {isLoading ? "Loading..." : `${(100 - readPercent).toFixed(1)}% remaining`}
          </Typography>
        </Box>
      </Card>

      {/* Monthly Writes */}
      <Card
        sx={{
          p: { xs: 2, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          gap: 1.75,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(245, 165, 36, 0.12)",
              color: "#f5a524",
            }}
          >
            <ArrowUpToLine size={16} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "var(--foreground)" }}>
              {isLoading ? "—" : writeOps.toLocaleString()}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {writeLimit.toLocaleString()} ops
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={Math.max(2, writePercent)}
            color={getLinearColor(writePercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
            {isLoading ? "Loading..." : `${(100 - writePercent).toFixed(1)}% remaining`}
          </Typography>
        </Box>
      </Card>

      {/* Total Objects */}
      <Card
        sx={{
          p: { xs: 2, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          gap: 1.75,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(61, 214, 140, 0.12)",
              color: "#3dd68c",
            }}
          >
            <FileText size={16} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <Typography variant="h5" sx={{ fontWeight: 700, color: "var(--foreground)" }}>
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
          </Box>
          <Box sx={{ pt: 1 }}>
            <Typography
              variant="caption"
              sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem", display: "block" }}
            >
              Real-time Durable Object storage & tracking
            </Typography>
          </Box>
        </Box>
      </Card>
    </Box>
  );
}
