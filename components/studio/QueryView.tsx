"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "sql-formatter";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Download,
  History,
  Play,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  Wand2,
} from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { StudioQueryResult } from "@/lib/studio/types";
import type { StudioTab } from "@/stores/studio-store";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { SqlEditor } from "@/components/studio/SqlEditor";
import { DataGrid } from "@/components/studio/DataGrid";
import { toCsv, toJsonExport } from "@/components/studio/format";

const SQL_SNIPPETS = [
  {
    label: "List all tables",
    sql: "SELECT name, sql\nFROM sqlite_master\nWHERE type = 'table' AND name NOT LIKE 'sqlite_%'\nORDER BY name;",
  },
  {
    label: "SQLite version & pragmas",
    sql: "SELECT sqlite_version() AS sqlite_version;",
  },
  {
    label: "Table row counts",
    sql: "SELECT name, type\nFROM sqlite_master\nWHERE type IN ('table', 'index')\nORDER BY type, name;",
  },
  {
    label: "Create sample table",
    sql: "CREATE TABLE IF NOT EXISTS notes (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  title TEXT NOT NULL,\n  body TEXT,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n);",
  },
];

export function QueryView({ tab }: { tab: StudioTab }) {
  const queryClient = useQueryClient();

  const sql = useStudioStore((s) => s.tabs.find((t) => t.id === tab.id)?.sql ?? "");
  const setSql = useStudioStore((s) => s.setSql);
  const addHistory = useStudioStore((s) => s.addHistory);
  const history = useStudioStore((s) => s.history);
  const savedQueries = useStudioStore((s) => s.savedQueries);
  const saveQuery = useStudioStore((s) => s.saveQuery);
  const deleteSavedQuery = useStudioStore((s) => s.deleteSavedQuery);

  const [allowWrite, setAllowWrite] = React.useState(false);
  const [result, setResult] = React.useState<StudioQueryResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [drawerMode, setDrawerMode] = React.useState<"history" | "saved" | null>(null);
  const [snippetsAnchor, setSnippetsAnchor] = React.useState<HTMLElement | null>(null);
  const [exportAnchor, setExportAnchor] = React.useState<HTMLElement | null>(null);

  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");

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
        void queryClient.invalidateQueries({ queryKey: ["studio", "table_details"] });
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

  const handleExport = (fmt: "csv" | "json") => {
    setExportAnchor(null);
    if (!result) return;
    const content =
      fmt === "csv"
        ? toCsv(result.columns, result.rows)
        : toJsonExport(result.columns, result.rows);
    const mime =
      fmt === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `query-result.${fmt}`;
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
          minHeight: 46,
          flexShrink: 0,
          flexWrap: "wrap",
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid var(--border)",
          bgcolor: "var(--card)",
          px: 1.5,
          py: 0.75,
        }}
      >
        <Button
          type="button"
          variant="contained"
          size="small"
          onClick={() => handleRun(sql)}
          disabled={mutation.isPending || !sql.trim()}
          startIcon={
            mutation.isPending ? (
              <CircularProgress size={13} color="inherit" />
            ) : (
              <Play size={14} />
            )
          }
          sx={{ height: 30, px: 1.5, fontSize: 12 }}
        >
          {mutation.isPending ? "Running…" : "Run"}
        </Button>

        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={handleFormat}
          title="Format SQL"
          startIcon={<Wand2 size={13} />}
          sx={{ height: 30, px: 1.25, fontSize: 12 }}
        >
          Format
        </Button>

        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={(e) => setSnippetsAnchor(e.currentTarget)}
          startIcon={<Sparkles size={13} />}
          sx={{ height: 30, px: 1.25, fontSize: 12 }}
        >
          Snippets
        </Button>

        <FormControlLabel
          sx={{
            ml: 0.5,
            px: 1,
            py: 0.25,
            borderRadius: "6px",
            border: allowWrite ? "1px solid rgba(245, 165, 36, 0.45)" : "1px solid transparent",
            bgcolor: allowWrite ? "rgba(245, 165, 36, 0.08)" : "transparent",
            "& .MuiFormControlLabel-label": {
              fontSize: 12,
              fontWeight: 500,
              color: allowWrite ? "var(--warning)" : "var(--muted-foreground)",
            },
          }}
          control={
            <Switch
              size="small"
              color="warning"
              checked={allowWrite}
              onChange={(e) => setAllowWrite(e.target.checked)}
            />
          }
          label={
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <span>Write Mode</span>
              {allowWrite && <ShieldAlert size={13} />}
            </Stack>
          }
        />

        <Box sx={{ flex: 1 }} />

        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={() => {
              setSaveName(tab.title);
              setSaveDialogOpen(true);
            }}
            disabled={!sql.trim()}
            startIcon={<Bookmark size={13} />}
            sx={{ height: 28, px: 1, fontSize: 12, color: "var(--muted-foreground)" }}
          >
            Save
          </Button>

          <Button
            type="button"
            variant={drawerMode === "saved" ? "contained" : "text"}
            size="small"
            onClick={() => setDrawerMode((m) => (m === "saved" ? null : "saved"))}
            sx={{ height: 28, px: 1, fontSize: 12 }}
          >
            Saved ({savedQueries.length})
          </Button>

          <Button
            type="button"
            variant={drawerMode === "history" ? "contained" : "text"}
            size="small"
            onClick={() => setDrawerMode((m) => (m === "history" ? null : "history"))}
            startIcon={<History size={13} />}
            sx={{ height: 28, px: 1, fontSize: 12 }}
          >
            History ({history.length})
          </Button>
        </Stack>
      </Box>

      {/* Saved / History Collapsible Panel */}
      <Collapse in={Boolean(drawerMode)}>
        {drawerMode === "history" && (
          <QueryListPanel
            title={`Recent Query History (${history.length})`}
            emptyText="No queries executed yet."
            items={history.map((h, i) => ({ id: String(i), label: h, sql: h }))}
            onSelect={(itemSql) => {
              setSql(tab.id, itemSql);
              setDrawerMode(null);
            }}
            onClear={() => {
              useStudioStore.getState().clearHistory();
              setDrawerMode(null);
            }}
            onClose={() => setDrawerMode(null)}
          />
        )}
        {drawerMode === "saved" && (
          <QueryListPanel
            title={`Saved Queries (${savedQueries.length})`}
            emptyText="Save frequently used SQL queries for quick access."
            items={savedQueries.map((sq) => ({
              id: sq.id,
              label: `${sq.name} — ${sq.sql}`,
              sql: sq.sql,
            }))}
            onSelect={(itemSql) => {
              setSql(tab.id, itemSql);
              setDrawerMode(null);
            }}
            onDeleteItem={(id) => deleteSavedQuery(id)}
            onClose={() => setDrawerMode(null)}
          />
        )}
      </Collapse>

      {/* Split Resizable Editor + Results */}
      <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Panel defaultSize={42} minSize={18} maxSize={80} style={{ minHeight: 0 }}>
          <SqlEditor value={sql} onChange={(next) => setSql(tab.id, next)} onRun={handleRun} />
        </Panel>

        <PanelResizeHandle
          style={{
            height: 4,
            backgroundColor: "var(--border)",
            cursor: "row-resize",
          }}
        />

        <Panel minSize={20} style={{ minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column" }}>
            {result && (
              <Box
                sx={{
                  display: "flex",
                  minHeight: 38,
                  flexShrink: 0,
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  borderBottom: "1px solid var(--border)",
                  bgcolor: "var(--card)",
                  px: 1.5,
                  py: 0.5,
                  fontSize: 12,
                  color: "var(--muted-foreground)",
                }}
              >
                <Stack direction="row" spacing={1.25} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "var(--success)" }}>
                    <CheckCircle2 size={13} />
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
                      {totalRows} {totalRows === 1 ? "row" : "rows"}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                    <Clock size={12} />
                    <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {result.durationMs} ms
                    </Box>
                  </Stack>

                  {result.rowsAffected !== null && result.rowsAffected > 0 && (
                    <Chip
                      size="small"
                      label={`${result.rowsAffected} affected`}
                      sx={{
                        height: 20,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        bgcolor: "rgba(61, 214, 140, 0.14)",
                        color: "var(--success)",
                      }}
                    />
                  )}

                  {result.lastInsertRowid && result.lastInsertRowid !== "0" && (
                    <Chip
                      size="small"
                      label={`Last Row ID: ${result.lastInsertRowid}`}
                      sx={{
                        height: 20,
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        bgcolor: "var(--muted)",
                      }}
                    />
                  )}

                  {result.truncated && (
                    <Chip
                      size="small"
                      label="Truncated to 1,000 rows"
                      sx={{
                        height: 20,
                        fontSize: 11,
                        bgcolor: "rgba(245,158,11,0.15)",
                        color: "#f5a524",
                      }}
                    />
                  )}
                </Stack>

                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={(e) => setExportAnchor(e.currentTarget)}
                  disabled={totalRows === 0}
                  startIcon={<Download size={13} />}
                  sx={{ height: 26, px: 1, fontSize: 11.5 }}
                >
                  Export
                </Button>
              </Box>
            )}

            {error ? (
              <Box sx={{ p: 2 }}>
                <Alert
                  severity="error"
                  sx={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                  }}
                >
                  {error}
                </Alert>
              </Box>
            ) : result ? (
              <Box sx={{ minHeight: 0, flex: 1 }}>
                {result.columns.length > 0 ? (
                  <DataGrid
                    columns={result.columns}
                    rows={result.rows}
                    emptyText="Query executed successfully and returned 0 rows."
                  />
                ) : (
                  <Box
                    sx={{
                      display: "flex",
                      height: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                      p: 3,
                    }}
                  >
                    <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
                      <CheckCircle2 size={28} color="var(--success)" />
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                        Statement executed successfully
                      </Typography>
                      <Typography sx={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
                        {result.rowsAffected !== null
                          ? `${result.rowsAffected} ${result.rowsAffected === 1 ? "row" : "rows"} affected in ${result.durationMs} ms.`
                          : `Completed in ${result.durationMs} ms.`}
                      </Typography>
                    </Stack>
                  </Box>
                )}
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
                <Stack spacing={1} sx={{ alignItems: "center", maxWidth: 380, textAlign: "center" }}>
                  <Terminal style={{ width: 24, height: 24, color: "var(--muted-foreground)", opacity: 0.5 }} />
                  <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                    Write a SQL query above and press{" "}
                    <Box component="kbd" sx={{ px: 0.6, py: 0.2, borderRadius: "4px", bgcolor: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      Cmd/Ctrl + Enter
                    </Box>{" "}
                    to execute. Highlight a selection to run only that statement.
                  </Typography>
                </Stack>
              </Box>
            )}
          </Box>
        </Panel>
      </PanelGroup>

      {/* Snippets Menu */}
      <Menu
        anchorEl={snippetsAnchor}
        open={Boolean(snippetsAnchor)}
        onClose={() => setSnippetsAnchor(null)}
      >
        {SQL_SNIPPETS.map((s) => (
          <MenuItem
            key={s.label}
            onClick={() => {
              setSql(tab.id, s.sql);
              setSnippetsAnchor(null);
            }}
            sx={{ fontSize: 12.5 }}
          >
            {s.label}
          </MenuItem>
        ))}
      </Menu>

      {/* Export Menu */}
      <Menu
        anchorEl={exportAnchor}
        open={Boolean(exportAnchor)}
        onClose={() => setExportAnchor(null)}
      >
        <MenuItem onClick={() => handleExport("csv")} sx={{ fontSize: 12.5 }}>
          Export as CSV (.csv)
        </MenuItem>
        <MenuItem onClick={() => handleExport("json")} sx={{ fontSize: 12.5 }}>
          Export as JSON (.json)
        </MenuItem>
      </Menu>

      {/* Save Query Dialog */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>Save SQL Query</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            label="Query Name"
            placeholder="e.g. Active users report"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button variant="outlined" size="small" onClick={() => setSaveDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={() => {
              saveQuery(saveName, sql);
              setSaveDialogOpen(false);
            }}
          >
            Save Query
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function QueryListPanel({
  title,
  emptyText,
  items,
  onSelect,
  onClear,
  onDeleteItem,
  onClose,
}: {
  title: string;
  emptyText: string;
  items: Array<{ id: string; label: string; sql: string }>;
  onSelect: (sql: string) => void;
  onClear?: () => void;
  onDeleteItem?: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        bgcolor: "var(--background)",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 0.75,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}>
          {title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {onClear && items.length > 0 && (
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={onClear}
              sx={{ minWidth: 0, p: 0.25, fontSize: 11.5, color: "var(--muted-foreground)" }}
            >
              Clear All
            </Button>
          )}
          <Button
            type="button"
            variant="text"
            size="small"
            onClick={onClose}
            sx={{ minWidth: 0, p: 0.25, fontSize: 11.5, color: "var(--muted-foreground)" }}
          >
            Close
          </Button>
        </Stack>
      </Box>
      {items.length === 0 ? (
        <Typography sx={{ px: 1.5, py: 1.5, fontSize: 12, color: "var(--muted-foreground)" }}>
          {emptyText}
        </Typography>
      ) : (
        <Stack
          component="ul"
          sx={{ m: 0, p: 0, py: 0.5, listStyle: "none", maxHeight: 170, overflowY: "auto" }}
        >
          {items.map((item) => (
            <Box
              component="li"
              key={item.id}
              sx={{
                display: "flex",
                alignItems: "center",
                "&:hover": { bgcolor: "var(--accent)" },
              }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => onSelect(item.sql)}
                title={item.sql}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  border: 0,
                  bgcolor: "transparent",
                  px: 1.5,
                  py: 0.6,
                  textAlign: "left",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--foreground)",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </Box>
              {onDeleteItem && (
                <IconButton
                  size="small"
                  onClick={() => onDeleteItem(item.id)}
                  sx={{ mr: 1, color: "var(--muted-foreground)", "&:hover": { color: "var(--destructive)" } }}
                >
                  <Trash2 size={13} />
                </IconButton>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
