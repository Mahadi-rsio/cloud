"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { Check, Copy, Pause, Play, Search, Terminal, Trash2 } from "lucide-react";
import {
  getDeploymentLogs,
  isTerminalDeploymentStatus,
  type DeploymentLogEntry,
  type DeploymentStatus,
} from "@/lib/deployments";
import { extractErrorMessage } from "@/lib/errors";

type StreamFilter = "all" | "stdout" | "stderr" | "system";

const STREAM_OPTIONS: { id: StreamFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stdout", label: "Out" },
  { id: "stderr", label: "Err" },
  { id: "system", label: "Sys" },
];

export function DeploymentLogsViewer({
  deploymentId,
  initialStatus,
  buildNumber,
}: {
  deploymentId: string;
  initialStatus: DeploymentStatus;
  buildNumber: number;
}) {
  const [logs, setLogs] = useState<DeploymentLogEntry[]>([]);
  const [status, setStatus] = useState<DeploymentStatus>(initialStatus);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const cursorRef = useRef(0);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    setLogs([]);
    setStatus(initialStatus);
    setError(null);
    setIsLoading(true);
    setConnected(false);
    cursorRef.current = 0;

    const stream = async () => {
      try {
        const history = await getDeploymentLogs(deploymentId, { limit: 500 });
        if (cancelled) return;
        setLogs(history.items);
        cursorRef.current = history.nextCursor;
        setStatus(history.status);
        if (isTerminalDeploymentStatus(history.status)) {
          setIsLoading(false);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(extractErrorMessage(err));
      }
      setIsLoading(false);

      const params = new URLSearchParams({ after: String(cursorRef.current) });
      es = new EventSource(
        `/api/v1/deployments/${deploymentId}/logs/stream?${params.toString()}`,
      );
      esRef.current = es;

      es.addEventListener("log", (event) => {
        try {
          const entry = JSON.parse((event as MessageEvent).data) as DeploymentLogEntry;
          const id = Number((event as MessageEvent).lastEventId || entry.id);
          if (id > cursorRef.current) cursorRef.current = id;
          setLogs((prev) => [...prev, entry]);
        } catch {
          // Ignore malformed frames.
        }
      });

      es.addEventListener("status", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            status: DeploymentStatus;
          };
          setStatus(data.status);
        } catch {
          // Ignore malformed frames.
        }
      });

      es.addEventListener("complete", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            status: DeploymentStatus;
          };
          setStatus(data.status);
        } catch {
          // Ignore malformed frames.
        }
        setConnected(false);
        es?.close();
      });

      es.addEventListener("error", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            message: string;
          };
          setError(data.message);
        } catch {
          // Ignore malformed frames.
        }
      });

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };
      es.onerror = () => {
        setConnected(false);
      };
    };

    void stream();

    return () => {
      cancelled = true;
      es?.close();
      esRef.current = null;
    };
  }, [deploymentId, buildNumber, initialStatus]);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (nearBottom !== autoScroll) setAutoScroll(nearBottom);
  };

  const filteredLogs = useMemoFilter(logs, streamFilter, searchQuery);

  const handleCopy = () => {
    const text = filteredLogs
      .map((l) => `[${formatTimestamp(l.timestamp)}] [${l.stream.toUpperCase()}] ${l.message}`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => setLogs([]);

  const terminal = isTerminalDeploymentStatus(status);

  return (
    <Box component="section" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            Build logs
          </Typography>
          <Box
            component="span"
            title={connected ? "Live" : "Disconnected"}
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: connected ? "#3dd68c" : "var(--muted-foreground)",
              ...(connected ? { animation: "pulse 2s infinite" } : {}),
            }}
          />
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => setAutoScroll(!autoScroll)}
            startIcon={autoScroll ? <Pause size={14} /> : <Play size={14} />}
          >
            {autoScroll ? "Pause" : "Resume"}
          </Button>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={filteredLogs.length === 0}
            onClick={handleCopy}
            startIcon={copied ? <Check size={14} color="#3dd68c" /> : <Copy size={14} />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={handleClear}
            startIcon={<Trash2 size={14} />}
            sx={{ color: "var(--muted-foreground)" }}
          >
            Clear
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          gap: 1.5,
        }}
      >
        <TextField
          size="small"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search logs…"
          sx={{ maxWidth: { sm: 320 }, flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={14} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={streamFilter}
            onChange={(_, v) => v && setStreamFilter(v)}
          >
            {STREAM_OPTIONS.map((option) => (
              <ToggleButton
                key={option.id}
                value={option.id}
                sx={{ px: 1.25, py: 0.25, fontSize: "0.75rem", textTransform: "capitalize" }}
              >
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
            }
            label={<Typography variant="caption">Auto-scroll</Typography>}
            sx={{ m: 0 }}
          />
        </Box>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper
        variant="outlined"
        sx={{
          overflow: "hidden",
          borderRadius: "12px",
          borderColor: "#27272a",
          backgroundColor: "#09090b",
          fontFamily: "var(--font-mono)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #27272a",
            backgroundColor: "#18181b",
            px: 2,
            py: 1.25,
            fontSize: "0.75rem",
            color: "#a1a1aa",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#ef4444" }} />
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#f59e0b" }} />
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", backgroundColor: "#10b981" }} />
            <Box sx={{ ml: 1, display: "flex", alignItems: "center", gap: 0.75, fontSize: "11px" }}>
              <Terminal size={12} />
              build · {buildNumber}
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, fontSize: "11px", color: "#71717a" }}>
            <span>
              {filteredLogs.length} line{filteredLogs.length === 1 ? "" : "s"}
            </span>
            {connected && !terminal && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "#34d399" }}>
                <Box
                  component="span"
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "#34d399",
                    animation: "pulse 2s infinite",
                  }}
                />
                streaming
              </Box>
            )}
            {terminal && <span style={{ color: "#a1a1aa" }}>closed</span>}
          </Box>
        </Box>

        <Box
          onScroll={handleScroll}
          sx={{
            maxHeight: 520,
            minHeight: 300,
            overflowY: "auto",
            p: 2,
            fontSize: "0.75rem",
            lineHeight: 1.6,
            color: "#e4e4e7",
          }}
        >
          {isLoading && logs.length === 0 ? (
            <Stack spacing={1} sx={{ py: 3 }}>
              <Skeleton variant="text" width="75%" sx={{ bgcolor: "#27272a" }} />
              <Skeleton variant="text" width="50%" sx={{ bgcolor: "#27272a" }} />
              <Skeleton variant="text" width="66%" sx={{ bgcolor: "#27272a" }} />
            </Stack>
          ) : filteredLogs.length === 0 ? (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                py: 8,
                textAlign: "center",
                color: "#71717a",
              }}
            >
              <Terminal size={32} strokeWidth={1.2} />
              <Typography variant="body2" sx={{ mt: 1, fontWeight: 500, color: "#a1a1aa" }}>
                {logs.length === 0
                  ? "Waiting for build output…"
                  : "No log lines match your active filter."}
              </Typography>
              <Typography variant="caption" sx={{ color: "#52525b", mt: 0.5 }}>
                {logs.length === 0
                  ? "Clone, prepare and build output will stream here live."
                  : "Try clearing the search query or switching the stream filter."}
              </Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {filteredLogs.map((log, idx) => (
                <Box
                  key={log.id || `${log.timestamp}-${idx}`}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1.5,
                    py: 0.25,
                    borderRadius: "4px",
                    "&:hover": { backgroundColor: "#18181b" },
                  }}
                >
                  <Box
                    component="span"
                    sx={{ flexShrink: 0, userSelect: "none", fontSize: "11px", color: "#71717a" }}
                  >
                    {formatTimestamp(log.timestamp)}
                  </Box>
                  <StreamBadge stream={log.stream} />
                  <Box
                    component="span"
                    sx={{ wordBreak: "break-all", whiteSpace: "pre-wrap", color: "#d4d4d8" }}
                  >
                    {log.message}
                  </Box>
                </Box>
              ))}
              <div ref={terminalEndRef} />
            </Stack>
          )}
        </Box>
      </Paper>
    </Box>
  );
}

function useMemoFilter(
  logs: DeploymentLogEntry[],
  streamFilter: StreamFilter,
  searchQuery: string,
): DeploymentLogEntry[] {
  const query = searchQuery.trim().toLowerCase();
  return logs.filter((log) => {
    if (streamFilter !== "all" && log.stream !== streamFilter) return false;
    if (query) {
      const message = log.message.toLowerCase();
      const stream = log.stream.toLowerCase();
      if (!message.includes(query) && !stream.includes(query)) return false;
    }
    return true;
  });
}

function StreamBadge({ stream }: { stream: DeploymentLogEntry["stream"] }) {
  const palette =
    stream === "stderr"
      ? { bg: "rgba(127, 29, 29, 0.6)", color: "#f87171", border: "rgba(153, 27, 27, 0.5)", label: "ERR" }
      : stream === "system"
        ? { bg: "rgba(88, 28, 135, 0.6)", color: "#d8b4fe", border: "rgba(107, 33, 168, 0.5)", label: "SYS" }
        : { bg: "rgba(22, 78, 99, 0.6)", color: "#67e8f9", border: "rgba(21, 94, 117, 0.5)", label: "OUT" };

  return (
    <Box
      component="span"
      sx={{
        flexShrink: 0,
        userSelect: "none",
        borderRadius: "4px",
        px: 0.75,
        py: 0.1,
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.05em",
        backgroundColor: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
      }}
    >
      {palette.label}
    </Box>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return isoString;
  }
}
