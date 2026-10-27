"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pause, Play, Search, Terminal, Trash2 } from "lucide-react";
import {
  getDeploymentLogs,
  isTerminalDeploymentStatus,
  type DeploymentLogEntry,
  type DeploymentStatus,
} from "@/lib/deployments";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

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
        // EventSource auto-reconnects; surface a brief disconnected state.
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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Build logs</h2>
          <span
            className={`size-2 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
            }`}
            title={connected ? "Live" : "Disconnected"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            className="gap-1.5 text-xs"
          >
            {autoScroll ? (
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
            disabled={filteredLogs.length === 0}
            onClick={handleCopy}
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
            onClick={handleClear}
            className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

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
        <div className="flex items-center gap-1.5 text-xs">
          {STREAM_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setStreamFilter(option.id)}
              className={`rounded-md px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                streamFilter === option.id
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
          <span className="ml-2 flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-input text-primary focus:ring-primary size-3.5"
            />
            Auto-scroll
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 font-mono shadow-md">
        <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-2.5 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-red-500/80" />
            <span className="size-3 rounded-full bg-amber-500/80" />
            <span className="size-3 rounded-full bg-emerald-500/80" />
            <span className="ml-2 font-mono text-[11px] text-zinc-400 flex items-center gap-1.5">
              <Terminal className="size-3 text-zinc-500" />
              build &middot; {buildNumber}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span>{filteredLogs.length} line{filteredLogs.length === 1 ? "" : "s"}</span>
            {connected && !terminal && (
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                streaming
              </span>
            )}
            {terminal && (
              <span className="text-zinc-400">closed</span>
            )}
          </div>
        </div>

        <div
          className="max-h-[520px] min-h-[300px] overflow-y-auto p-4 text-xs leading-relaxed text-zinc-200 selection:bg-zinc-700"
          onScroll={handleScroll}
        >
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
                  ? "Waiting for build output…"
                  : "No log lines match your active filter."}
              </p>
              <p className="font-sans text-xs text-zinc-600 mt-1">
                {logs.length === 0
                  ? "Clone, prepare and build output will stream here live."
                  : "Try clearing the search query or switching the stream filter."}
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
                  <StreamBadge stream={log.stream} />
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
    </section>
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
  switch (stream) {
    case "stderr":
      return (
        <span className="shrink-0 select-none rounded bg-red-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-red-400 border border-red-800/40">
          ERR
        </span>
      );
    case "system":
      return (
        <span className="shrink-0 select-none rounded bg-purple-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-purple-300 border border-purple-800/40">
          SYS
        </span>
      );
    default:
      return (
        <span className="shrink-0 select-none rounded bg-cyan-950/80 px-1.5 py-0.2 text-[10px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-800/40">
          OUT
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