"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import {
  Check,
  Copy,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  getApplicationLogs,
  type Application,
  type Machine,
  type MachineLogEntry,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";

type LogLevel = "all" | "info" | "warn" | "error" | "system";

export function MachineLogsViewer({
  application,
  machines,
}: {
  application: Application;
  machines: Machine[];
}) {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(
    () => machines[0]?.id || "",
  );
  const [logs, setLogs] = useState<MachineLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (machines.length > 0 && !machines.some((m) => m.id === selectedMachineId)) {
      setSelectedMachineId(machines[0].id);
    }
  }, [machines, selectedMachineId]);

  const activeMachine = useMemo(
    () => machines.find((m) => m.id === selectedMachineId) || machines[0],
    [machines, selectedMachineId],
  );

  const fetchLogs = async (isInitial = false) => {
    try {
      if (isInitial) setIsLoading(true);
      else setIsRefreshing(true);
      setError(null);

      const res = await getApplicationLogs(application.id, {
        machineId: selectedMachineId || undefined,
      });

      setLogs(res.logs || []);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      if (isInitial) setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchLogs(true);
  }, [application.id, selectedMachineId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchLogs(false);
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, application.id, selectedMachineId]);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (levelFilter !== "all") {
        const itemLevel = log.level || "info";
        if (itemLevel !== levelFilter) return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesMsg = log.message.toLowerCase().includes(query);
        const matchesLevel = (log.level || "").toLowerCase().includes(query);
        const matchesInstance = (log.instance || "").toLowerCase().includes(query);
        if (!matchesMsg && !matchesLevel && !matchesInstance) return false;
      }
      return true;
    });
  }, [logs, levelFilter, searchQuery]);

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map(
        (l) =>
          `[${formatTimestamp(l.timestamp)}] [${(l.level || "info").toUpperCase()}] ${l.message}`,
      )
      .join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearView = () => {
    setLogs([]);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Top Controls Bar */}
      <Paper
        variant="outlined"
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          gap: 1.5,
          borderRadius: "12px",
          p: 2,
        }}
      >
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1.5 }}>
          {machines.length > 1 ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Server size={16} color="var(--muted-foreground)" />
              <TextField
                select
                size="small"
                value={selectedMachineId}
                onChange={(e) => setSelectedMachineId(e.target.value)}
                sx={{ width: 200 }}
              >
                {machines.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    Instance {m.instanceNumber + 1} ({m.flyMachineId?.slice(0, 8) || m.id.slice(0, 8)})
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          ) : activeMachine ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                Machine:
              </Typography>
              <span>{activeMachine.flyMachineId || activeMachine.id}</span>
              <Chip
                size="small"
                label={activeMachine.region.toUpperCase()}
                sx={{ height: 18, fontSize: "10px" }}
              />
            </Box>
          ) : null}

          <Chip
            size="small"
            variant="outlined"
            icon={
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  ml: 0.75,
                  backgroundColor: autoRefresh ? "#3dd68c" : "var(--muted-foreground)",
                  ...(autoRefresh ? { animation: "pulse 2s infinite" } : {}),
                }}
              />
            }
            label={autoRefresh ? "Live polling" : "Paused"}
          />
        </Box>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => setAutoRefresh(!autoRefresh)}
            startIcon={autoRefresh ? <Pause size={14} /> : <Play size={14} />}
          >
            {autoRefresh ? "Pause" : "Resume"}
          </Button>

          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={isRefreshing}
            onClick={() => void fetchLogs(false)}
            startIcon={
              <RefreshCw
                size={14}
                style={isRefreshing ? { animation: "spin 1s linear infinite" } : undefined}
              />
            }
          >
            Refresh
          </Button>

          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={filteredLogs.length === 0}
            onClick={handleCopyLogs}
            startIcon={copied ? <Check size={14} color="#3dd68c" /> : <Copy size={14} />}
          >
            {copied ? "Copied" : "Copy"}
          </Button>

          <Button
            type="button"
            variant="text"
            size="small"
            onClick={handleClearView}
            startIcon={<Trash2 size={14} />}
            sx={{ color: "var(--muted-foreground)" }}
          >
            Clear
          </Button>
        </Stack>
      </Paper>

      {/* Filter Sub-bar */}
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
          <Typography variant="caption" color="text.secondary">
            Level:
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={levelFilter}
            onChange={(_, v) => v && setLevelFilter(v)}
          >
            {(["all", "info", "warn", "error", "system"] as const).map((lvl) => (
              <ToggleButton
                key={lvl}
                value={lvl}
                sx={{ px: 1.25, py: 0.25, fontSize: "0.75rem", textTransform: "capitalize" }}
              >
                {lvl}
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

      {/* Terminal Container */}
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
              logs · {application.slug}
              {activeMachine?.flyMachineId ? ` (${activeMachine.flyMachineId})` : ""}
            </Box>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, fontSize: "11px", color: "#71717a" }}>
            <span>
              {filteredLogs.length} line{filteredLogs.length === 1 ? "" : "s"}
            </span>
            {isRefreshing && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "#34d399" }}>
                <RefreshCw size={10} style={{ animation: "spin 1s linear infinite" }} />
                syncing
              </Box>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            maxHeight: 500,
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
                  ? "Waiting for logs from microVM…"
                  : "No log lines match your active filter."}
              </Typography>
              <Typography variant="caption" sx={{ color: "#52525b", mt: 0.5 }}>
                {logs.length === 0
                  ? "MicroVM output and lifecycle events will stream here automatically."
                  : "Try clearing the search query or selecting 'All' levels."}
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
                  <LevelBadge level={log.level} />
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

function LevelBadge({ level }: { level?: string }) {
  const palette =
    level === "error"
      ? { bg: "rgba(127, 29, 29, 0.6)", color: "#f87171", border: "rgba(153, 27, 27, 0.5)", label: "ERROR" }
      : level === "warn"
        ? { bg: "rgba(120, 53, 15, 0.6)", color: "#fcd34d", border: "rgba(146, 64, 14, 0.5)", label: "WARN" }
        : level === "system"
          ? { bg: "rgba(88, 28, 135, 0.6)", color: "#d8b4fe", border: "rgba(107, 33, 168, 0.5)", label: "SYSTEM" }
          : { bg: "rgba(22, 78, 99, 0.6)", color: "#67e8f9", border: "rgba(21, 94, 117, 0.5)", label: "INFO" };

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
