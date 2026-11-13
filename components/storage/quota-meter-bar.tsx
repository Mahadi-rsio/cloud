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
  hasError = false,
}: {
  usage: StorageUsageResponse | null;
  isLoading?: boolean;
  hasError?: boolean;
}) {
  const unavailable = !isLoading && (hasError || !usage);

  const usedBytes = usage?.usedBytes ?? 0;
  const storageLimitBytes = usage?.storageLimitBytes ?? 536_870_912; // 512 MB
  const storagePercent = unavailable
    ? 0
    : Math.min(100, storageLimitBytes > 0 ? (usedBytes / storageLimitBytes) * 100 : 0);

  const readOps = usage?.monthlyReadOps ?? 0;
  const readLimit = usage?.monthlyReadLimitOps ?? 100_000;
  const readPercent = unavailable
    ? 0
    : Math.min(100, readLimit > 0 ? (readOps / readLimit) * 100 : 0);

  const writeOps = usage?.monthlyWriteOps ?? 0;
  const writeLimit = usage?.monthlyWriteLimitOps ?? 100_000;
  const writePercent = unavailable
    ? 0
    : Math.min(100, writeLimit > 0 ? (writeOps / writeLimit) * 100 : 0);

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
        gridTemplateColumns: {
          xs: "repeat(2, minmax(0, 1fr))",
          lg: "repeat(4, minmax(0, 1fr))",
        },
        gap: { xs: 1.5, sm: 2 },
      }}
    >
      {/* Storage Capacity */}
      <Card
        sx={{
          p: { xs: 1.75, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              fontSize: { xs: "0.68rem", sm: "0.75rem" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Storage Capacity
          </Typography>
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <HardDrive size={15} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: "var(--foreground)",
                fontSize: { xs: "1.15rem", sm: "1.35rem" },
              }}
            >
              {isLoading || unavailable ? "—" : formatBytes(usedBytes)}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {formatBytes(storageLimitBytes)}
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={unavailable || isLoading ? 0 : storagePercent}
            color={getLinearColor(storagePercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {isLoading
              ? "Loading..."
              : unavailable
                ? "Unavailable"
                : `${storagePercent.toFixed(1)}% free tier used`}
          </Typography>
        </Box>
      </Card>

      {/* Monthly Reads */}
      <Card
        sx={{
          p: { xs: 1.75, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              fontSize: { xs: "0.68rem", sm: "0.75rem" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Monthly Reads
          </Typography>
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(14, 165, 233, 0.12)",
              color: "#0ea5e9",
            }}
          >
            <ArrowDownToLine size={15} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: "var(--foreground)",
                fontSize: { xs: "1.15rem", sm: "1.35rem" },
              }}
            >
              {isLoading || unavailable ? "—" : readOps.toLocaleString()}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {readLimit.toLocaleString()} ops
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={unavailable || isLoading ? 0 : readPercent}
            color={getLinearColor(readPercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {isLoading
              ? "Loading..."
              : unavailable
                ? "Unavailable"
                : `${(100 - readPercent).toFixed(1)}% remaining`}
          </Typography>
        </Box>
      </Card>

      {/* Monthly Writes */}
      <Card
        sx={{
          p: { xs: 1.75, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              fontSize: { xs: "0.68rem", sm: "0.75rem" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Monthly Writes
          </Typography>
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(245, 165, 36, 0.12)",
              color: "#f5a524",
            }}
          >
            <ArrowUpToLine size={15} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: "var(--foreground)",
                fontSize: { xs: "1.15rem", sm: "1.35rem" },
              }}
            >
              {isLoading || unavailable ? "—" : writeOps.toLocaleString()}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              of {writeLimit.toLocaleString()} ops
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={unavailable || isLoading ? 0 : writePercent}
            color={getLinearColor(writePercent)}
            sx={{ height: 6, borderRadius: 3, backgroundColor: "var(--muted)" }}
          />
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {isLoading
              ? "Loading..."
              : unavailable
                ? "Unavailable"
                : `${(100 - writePercent).toFixed(1)}% remaining`}
          </Typography>
        </Box>
      </Card>

      {/* Stored Objects */}
      <Card
        sx={{
          p: { xs: 1.75, sm: 2.5 },
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              fontSize: { xs: "0.68rem", sm: "0.75rem" },
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Stored Objects
          </Typography>
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(61, 214, 140, 0.12)",
              color: "#3dd68c",
            }}
          >
            <FileText size={15} />
          </Box>
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            <Typography
              variant="h5"
              sx={{
                fontWeight: 700,
                color: "var(--foreground)",
                fontSize: { xs: "1.15rem", sm: "1.35rem" },
              }}
            >
              {isLoading || unavailable ? "—" : fileCount.toLocaleString()}
            </Typography>
            <Chip
              size="small"
              label={(usage?.plan || "free").toUpperCase() + " PLAN"}
              sx={{
                height: 20,
                fontSize: "0.65rem",
                fontWeight: 700,
                backgroundColor: "rgba(61, 214, 140, 0.12)",
                color: "#3dd68c",
              }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontSize: "0.72rem" }}>
            {unavailable
              ? "Metrics unavailable"
              : "S3-compatible R2 storage with zero egress fee"}
          </Typography>
        </Box>
      </Card>
    </Box>
  );
}
