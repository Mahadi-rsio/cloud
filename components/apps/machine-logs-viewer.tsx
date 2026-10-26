"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

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

  // Sync selected machine if machines change
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

  // Initial fetch and on machine change
  useEffect(() => {
    void fetchLogs(true);
  }, [application.id, selectedMachineId]);

  // Live auto-refresh polling interval (every 4 seconds)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchLogs(false);
    }, 4000);
    return () => clearInterval(interval);
  }, [autoRefresh, application.id, selectedMachineId]);

  // Auto-scroll to bottom when new logs arrive if enabled
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (levelFilter !== "all") {
        const itemLevel = log.level || "info";
        if (itemLevel !== levelFilter) return false;
      }
      // Search filter
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
    <div className="flex flex-col gap-4">
      {/* Top Filter and Controls Bar */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: Machine Selector & Stream Status */}
        <div className="flex flex-wrap items-center gap-3">
          {machines.length > 1 ? (
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <Select
                value={selectedMachineId}
                onChange={(e) => setSelectedMachineId(e.target.value)}
                className="w-48 text-xs font-mono"
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    Instance {m.instanceNumber + 1} ({m.flyMachineId?.slice(0, 8) || m.id.slice(0, 8)})
                  </option>
                ))}
              </Select>
            </div>
          ) : activeMachine ? (
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <span className="font-semibold text-foreground">Machine:</span>
              <span>{activeMachine.flyMachineId || activeMachine.id}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {activeMachine.region}
              </span>
            </div>
          ) : null}

          {/* Live indicator badge */}
          <div className="flex items-center gap-2 rounded-full border bg-muted/40 px-2.5 py-1 text-xs">
            <span
              className={`size-2 rounded-full ${
                autoRefresh ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
              }`}
            />
            <span className="font-medium text-foreground">
              {autoRefresh ? "Live polling" : "Paused"}
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="gap-1.5 text-xs"
          >
            {autoRefresh ? (
              <>
                <Pause className="size-3.5" />
                Pause
              </>
            ) : (
              <>
                <Play className="size-3.5" />
                Resume
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => void fetchLogs(false)}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={filteredLogs.length === 0}
            onClick={handleCopyLogs}
            className="gap-1.5 text-xs"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearView}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Filter and Search Sub-bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs…"
            className="pl-8 text-xs h-8"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Level:</span>
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
            {(["all", "info", "warn", "error", "system"] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevelFilter(lvl)}
                className={`rounded-md px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                  levelFilter === lvl
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-input text-primary focus:ring-primary size-3.5"
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Error alert if load failed */}
      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Terminal Container */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 font-mono shadow-md">
        {/* Terminal Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-2.5 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-red-500/80" />
            <span className="size-3 rounded-full bg-amber-500/80" />
            <span className="size-3 rounded-full bg-emerald-500/80" />
            <span className="ml-2 font-mono text-[11px] text-zinc-400 flex items-center gap-1.5">
              <Terminal className="size-3 text-zinc-500" />
              logs &middot; {application.slug}
              {activeMachine?.flyMachineId ? ` (${activeMachine.flyMachineId})` : ""}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span>{filteredLogs.length} line{filteredLogs.length === 1 ? "" : "s"}</span>
            {isRefreshing && (
              <span className="flex items-center gap-1 text-emerald-400">
                <RefreshCw className="size-2.5 animate-spin" />
                syncing
              </span>
            )}
          </div>
        </div>

        {/* Terminal Body */}
        <div className="max-h-[500px] min-h-[300px] overflow-y-auto p-4 text-xs leading-relaxed text-zinc-200 selection:bg-zinc-700">
          {isLoading && logs.length === 0 ? (
            <div className="flex flex-col gap-2 py-6">
              <Skeleton className="h-4 w-3/4 bg-zinc-800/60" />
              <Skeleton className="h-4 w-1/2 bg-zinc-800/60" />
              <Skeleton className="h-4 w-2/3 bg-zinc-800/60" />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-zinc-500">
              <Terminal className="size-8 stroke-1 text-zinc-600 mb-2" />
              <p className="font-sans text-sm font-medium text-zinc-400">
                {logs.length === 0
                  ? "Waiting for logs from microVM…"
                  : "No log lines match your active filter."}
              </p>
              <p className="font-sans text-xs text-zinc-600 mt-1">
                {logs.length === 0
                  ? "MicroVM output and lifecycle events will stream here automatically."
                  : "Try clearing the search query or selecting 'All' levels."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredLogs.map((log, idx) => (
                <div
                  key={log.id || `${log.timestamp}-${idx}`}
                  className="group flex items-start gap-3 rounded-xs py-0.5 hover:bg-zinc-900/60 transition-colors"
                >
                  <span className="shrink-0 select-none font-mono text-[11px] text-zinc-500">
                    {formatTimestamp(log.timestamp)}
                  </span>
                  <LevelBadge level={log.level} />
                  <span className="break-all whitespace-pre-wrap text-zinc-300 group-hover:text-zinc-100">
                    {log.message}
                  </span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LevelBadge({ level }: { level?: string }) {
  switch (level) {
    case "error":
      return (
        <span className="shrink-0 select-none rounded bg-red-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-red-400 border border-red-800/40">
          ERROR
        </span>
      );
    case "warn":
      return (
        <span className="shrink-0 select-none rounded bg-amber-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-amber-300 border border-amber-800/40">
          WARN
        </span>
      );
    case "system":
      return (
        <span className="shrink-0 select-none rounded bg-purple-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-purple-300 border border-purple-800/40">
          SYSTEM
        </span>
      );
    default:
      return (
        <span className="shrink-0 select-none rounded bg-cyan-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-800/40">
          INFO
        </span>
      );
  }
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
