"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "sql-formatter";
import {
  Download,
  History,
  Play,
  ShieldAlert,
  Terminal,
  Wand2,
} from "lucide-react";
import type { StudioQueryResult } from "@/lib/studio/types";
import type { StudioTab } from "@/stores/studio-store";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { SqlEditor } from "@/components/studio/SqlEditor";
import { DataGrid } from "@/components/studio/DataGrid";
import { toCsv } from "@/components/studio/format";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function QueryView({ tab }: { tab: StudioTab }) {
  const queryClient = useQueryClient();

  const sql = useStudioStore((s) => s.tabs.find((t) => t.id === tab.id)?.sql ?? "");
  const setSql = useStudioStore((s) => s.setSql);
  const addHistory = useStudioStore((s) => s.addHistory);

  const [allowWrite, setAllowWrite] = React.useState(false);
  const [result, setResult] = React.useState<StudioQueryResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  const history = useStudioStore((s) => s.history);

  const mutation = useMutation({
    mutationFn: (vars: { sql: string; allowWrite: boolean }) => studioApi.query(vars),
    onSuccess: (data, vars) => {
      setResult(data);
      setError(null);
      addHistory(vars.sql);
      if (vars.allowWrite) {
        void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
        void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
        void queryClient.invalidateQueries({ queryKey: ["studio", "rows"] });
      }
    },
    onError: (err) => {
      setResult(null);
      setError(err instanceof Error ? err.message : "Query failed.");
    },
  });

  const handleRun = (targetSql: string) => {
    mutation.mutate({ sql: targetSql, allowWrite });
  };

  const handleFormat = () => {
    try {
      setSql(tab.id, format(sql, { language: "sqlite" }));
    } catch {
      // leave the SQL as-is if it cannot be parsed
    }
  };

  const handleExport = () => {
    if (!result) return;
    const csv = toCsv(result.columns, result.rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "query-result.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const totalRows = result?.rows.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-3"
          onClick={() => handleRun(sql)}
          disabled={mutation.isPending}
        >
          <Play className="size-3.5" />
          {mutation.isPending ? "Running…" : "Run"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-3"
          onClick={handleFormat}
          title="Format SQL"
        >
          <Wand2 className="size-3.5" />
          Format
        </Button>

        <label className="ml-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch
            checked={allowWrite}
            onCheckedChange={setAllowWrite}
            className="scale-90"
          />
          <span className="flex items-center gap-1">
            Allow writes
            {allowWrite && (
              <ShieldAlert className="size-3.5 text-amber-500" />
            )}
          </span>
        </label>

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2"
          onClick={() => setHistoryOpen((open) => !open)}
          title="Query history"
        >
          <History className="size-3.5" />
          History
        </Button>
      </div>

      {/* Editor */}
      <div className="h-[40%] min-h-[160px] shrink-0 border-b">
        <SqlEditor value={sql} onChange={(next) => setSql(tab.id, next)} onRun={handleRun} />
      </div>

      {/* History panel */}
      {historyOpen && (
        <HistoryPanel
          items={history}
          onSelect={(item) => {
            setSql(tab.id, item);
            setHistoryOpen(false);
          }}
          onClear={() => {
            useStudioStore.getState().clearHistory();
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* Results */}
      <div className="flex min-h-0 flex-1 flex-col">
        {result && (
          <div className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              {totalRows} {totalRows === 1 ? "row" : "rows"}
              <span className="tabular-nums">· {result.durationMs} ms</span>
              {result.rowsAffected != null && (
                <span className="tabular-nums">· {result.rowsAffected} affected</span>
              )}
              {result.truncated && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-600">
                  Truncated to 1000 rows
                </span>
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2"
              onClick={handleExport}
              disabled={totalRows === 0}
            >
              <Download className="size-3.5" />
              Export CSV
            </Button>
          </div>
        )}

        {error ? (
          <div className="m-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : result ? (
          <div className="min-h-0 flex-1">
            <DataGrid
              columns={result.columns}
              rows={result.rows}
              emptyText="Query returned no rows."
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-2 text-center">
              <Terminal className="size-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                Write a query and press Run (or Ctrl/Cmd + Enter) to see results.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryPanel({
  items,
  onSelect,
  onClear,
  onClose,
}: {
  items: string[];
  onSelect: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="shrink-0 border-b bg-muted/20">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold text-muted-foreground">
          Query history ({items.length})
        </span>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Close
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">No queries yet.</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto pb-1">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className="block w-full truncate px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                title={item}
              >
                {item}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}