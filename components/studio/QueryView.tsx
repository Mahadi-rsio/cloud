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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { StudioQueryResult } from "@/lib/studio/types";
import type { StudioTab } from "@/stores/studio-store";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { SqlEditor } from "@/components/studio/SqlEditor";
import { DataGrid } from "@/components/studio/DataGrid";
import { toCsv } from "@/components/studio/format";

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
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: "flex",
          height: 40,
          flexShrink: 0,
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid var(--border)",
          px: 1.5,
        }}
      >
        <Button
          type="button"
          variant="contained"
          size="small"
          onClick={() => handleRun(sql)}
          disabled={mutation.isPending}
          startIcon={<Play style={{ width: 14, height: 14 }} />}
          sx={{ height: 28, px: 1.5, fontSize: 12 }}
        >
          {mutation.isPending ? "Running…" : "Run"}
        </Button>
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={handleFormat}
          title="Format SQL"
          startIcon={<Wand2 style={{ width: 14, height: 14 }} />}
          sx={{ height: 28, px: 1.5, fontSize: 12 }}
        >
          Format
        </Button>

        <FormControlLabel
          sx={{ ml: 1, "& .MuiFormControlLabel-label": { fontSize: 12, fontWeight: 500, color: "var(--muted-foreground)" } }}
          control={
            <Switch
              size="small"
              checked={allowWrite}
              onChange={(e) => setAllowWrite(e.target.checked)}
            />
          }
          label={
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <span>Allow writes</span>
              {allowWrite && <ShieldAlert style={{ width: 14, height: 14, color: "#f59e0b" }} />}
            </Stack>
          }
        />

        <Box sx={{ flex: 1 }} />

        <Button
          type="button"
          variant="text"
          size="small"
          onClick={() => setHistoryOpen((open) => !open)}
          title="Query history"
          startIcon={<History style={{ width: 14, height: 14 }} />}
          sx={{ height: 28, px: 1, fontSize: 12, color: "var(--foreground)" }}
        >
          History
        </Button>
      </Box>

      {/* Editor */}
      <Box sx={{ height: "40%", minHeight: 160, flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
        <SqlEditor value={sql} onChange={(next) => setSql(tab.id, next)} onRun={handleRun} />
      </Box>

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
      <Box sx={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column" }}>
        {result && (
          <Box
            sx={{
              display: "flex",
              height: 36,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid var(--border)",
              px: 1.5,
              fontSize: 12,
              color: "var(--muted-foreground)",
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <span>
                {totalRows} {totalRows === 1 ? "row" : "rows"}
              </span>
              <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                · {result.durationMs} ms
              </Box>
              {result.rowsAffected != null && (
                <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  · {result.rowsAffected} affected
                </Box>
              )}
              {result.truncated && (
                <Box
                  component="span"
                  sx={{
                    borderRadius: 1,
                    bgcolor: "rgba(245,158,11,0.15)",
                    px: 0.75,
                    py: 0.25,
                    fontWeight: 500,
                    color: "#d97706",
                  }}
                >
                  Truncated to 1000 rows
                </Box>
              )}
            </Stack>
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={handleExport}
              disabled={totalRows === 0}
              startIcon={<Download style={{ width: 14, height: 14 }} />}
              sx={{ height: 24, px: 1, fontSize: 12, color: "var(--foreground)" }}
            >
              Export CSV
            </Button>
          </Box>
        )}

        {error ? (
          <Box
            sx={{
              m: 1.5,
              borderRadius: 1.5,
              border: "1px solid rgba(239,68,68,0.3)",
              bgcolor: "rgba(239,68,68,0.06)",
              p: 1.5,
              fontSize: 13.5,
              color: "var(--destructive)",
            }}
          >
            {error}
          </Box>
        ) : result ? (
          <Box sx={{ minHeight: 0, flex: 1 }}>
            <DataGrid
              columns={result.columns}
              rows={result.rows}
              emptyText="Query returned no rows."
            />
          </Box>
        ) : (
          <Box
            sx={{
              display: "flex",
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              p: 3,
            }}
          >
            <Stack spacing={1} sx={{ alignItems: "center", maxWidth: 360, textAlign: "center" }}>
              <Terminal style={{ width: 24, height: 24, color: "var(--muted-foreground)", opacity: 0.5 }} />
              <Typography sx={{ fontSize: 13.5, color: "var(--muted-foreground)" }}>
                Write a query and press Run (or Ctrl/Cmd + Enter) to see results.
              </Typography>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
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
    <Box
      sx={{
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        bgcolor: "rgba(255,255,255,0.02)",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.75,
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}>
          Query history ({items.length})
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {items.length > 0 && (
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={onClear}
              sx={{ minWidth: 0, p: 0.25, fontSize: 12, color: "var(--muted-foreground)" }}
            >
              Clear
            </Button>
          )}
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={onClose}
            sx={{ minWidth: 0, p: 0.25, fontSize: 12, color: "var(--muted-foreground)" }}
          >
            Close
          </Button>
        </Stack>
      </Box>
      {items.length === 0 ? (
        <Typography sx={{ px: 1.5, pb: 1, fontSize: 12, color: "var(--muted-foreground)" }}>
          No queries yet.
        </Typography>
      ) : (
        <Stack component="ul" sx={{ m: 0, p: 0, pb: 0.5, listStyle: "none", maxHeight: 160, overflowY: "auto" }}>
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>
              <Box
                component="button"
                type="button"
                onClick={() => onSelect(item)}
                title={item}
                sx={{
                  display: "block",
                  width: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  border: 0,
                  bgcolor: "transparent",
                  px: 1.5,
                  py: 0.5,
                  textAlign: "left",
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                  cursor: "pointer",
                  "&:hover": {
                    bgcolor: "rgba(255,255,255,0.05)",
                    color: "var(--foreground)",
                  },
                }}
              >
                {item}
              </Box>
            </li>
          ))}
        </Stack>
      )}
    </Box>
  );
}
