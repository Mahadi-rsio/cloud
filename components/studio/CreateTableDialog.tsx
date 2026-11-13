"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Code2,
  KeyRound,
  Link2,
  Plus,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { studioApi } from "@/lib/studio-api";
import type { CreateColumnInput } from "@/lib/studio/types";

const COLUMN_TYPES = [
  "INTEGER",
  "TEXT",
  "REAL",
  "NUMERIC",
  "BOOLEAN",
  "DATETIME",
  "JSON",
  "BLOB",
  "UUID",
];

const DEFAULT_SUGGESTIONS: Record<string, string[]> = {
  INTEGER: ["0", "1"],
  TEXT: ["''", "'active'"],
  REAL: ["0.0"],
  NUMERIC: ["0"],
  BOOLEAN: ["0", "1", "TRUE", "FALSE"],
  DATETIME: ["CURRENT_TIMESTAMP", "CURRENT_DATE"],
  JSON: ["'{}'", "'[]'"],
  BLOB: ["NULL"],
  UUID: ["NULL"],
};

interface ColumnDraft extends CreateColumnInput {
  id: string;
  showFk: boolean;
}

function makeColumnDraft(overrides?: Partial<ColumnDraft>): ColumnDraft {
  return {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    type: "TEXT",
    primaryKey: false,
    autoIncrement: false,
    notNull: false,
    unique: false,
    defaultValue: "",
    references: null,
    showFk: false,
    ...overrides,
  };
}

function previewCreateSql(
  tableName: string,
  columns: ColumnDraft[],
  strict: boolean,
): string {
  const safeTable = tableName.trim() || "my_table";
  const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;

  const validCols = columns.filter((c) => c.name.trim() !== "");
  if (validCols.length === 0) {
    return `-- Add at least one named column to preview DDL\nCREATE TABLE ${quote(safeTable)} (\n  ...\n);`;
  }

  const pkCols = validCols.filter((c) => c.primaryKey);
  const isCompositePk = pkCols.length > 1;

  const lines: string[] = [];
  const fks: string[] = [];

  for (const col of validCols) {
    const parts = [quote(col.name.trim())];
    if (col.primaryKey && !isCompositePk) {
      if (col.autoIncrement) {
        parts.push("INTEGER PRIMARY KEY AUTOINCREMENT");
      } else {
        parts.push(col.type, "PRIMARY KEY");
      }
    } else {
      parts.push(col.type);
    }

    if (col.notNull && !(col.primaryKey && !isCompositePk)) {
      parts.push("NOT NULL");
    }
    if (col.unique && !(col.primaryKey && !isCompositePk)) {
      parts.push("UNIQUE");
    }
    if (col.defaultValue && col.defaultValue.trim()) {
      parts.push(`DEFAULT ${col.defaultValue.trim()}`);
    }

    if (col.references?.table && col.references?.column) {
      fks.push(
        `FOREIGN KEY (${quote(col.name.trim())}) REFERENCES ${quote(col.references.table)}(${quote(col.references.column)}) ON DELETE ${col.references.onDelete || "NO ACTION"}`,
      );
    }

    lines.push(`  ${parts.join(" ")}`);
  }

  if (isCompositePk) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => quote(c.name.trim())).join(", ")})`);
  }

  for (const fk of fks) {
    lines.push(`  ${fk}`);
  }

  return `CREATE TABLE ${quote(safeTable)} (\n${lines.join(",\n")}\n)${strict ? " STRICT" : ""};`;
}

interface CreateTableDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (tableName: string) => void;
}

export function CreateTableDialog({ open, onClose, onCreated }: CreateTableDialogProps) {
  const queryClient = useQueryClient();

  const [tableName, setTableName] = React.useState("");
  const [strictMode, setStrictMode] = React.useState(false);
  const [showSqlPreview, setShowSqlPreview] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [columns, setColumns] = React.useState<ColumnDraft[]>(() => [
    makeColumnDraft({
      name: "id",
      type: "INTEGER",
      primaryKey: true,
      autoIncrement: true,
      notNull: true,
    }),
    makeColumnDraft({
      name: "created_at",
      type: "DATETIME",
      notNull: true,
      defaultValue: "CURRENT_TIMESTAMP",
    }),
  ]);

  const schemaQuery = useQuery({
    queryKey: ["studio", "schema"],
    queryFn: () => studioApi.schema(),
    enabled: open,
    staleTime: 60_000,
  });

  const existingTables = React.useMemo(
    () => Object.keys(schemaQuery.data ?? {}),
    [schemaQuery.data],
  );

  React.useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  const resetForm = () => {
    setTableName("");
    setStrictMode(false);
    setError(null);
    setColumns([
      makeColumnDraft({
        name: "id",
        type: "INTEGER",
        primaryKey: true,
        autoIncrement: true,
        notNull: true,
      }),
      makeColumnDraft({
        name: "created_at",
        type: "DATETIME",
        notNull: true,
        defaultValue: "CURRENT_TIMESTAMP",
      }),
    ]);
  };

  const mutation = useMutation({
    mutationFn: () =>
      studioApi.createTable({
        name: tableName.trim(),
        strict: strictMode,
        columns: columns.map((c) => ({
          name: c.name.trim(),
          type: c.type,
          primaryKey: c.primaryKey,
          autoIncrement: c.autoIncrement,
          notNull: c.notNull,
          unique: c.unique,
          defaultValue: c.defaultValue?.trim() ? c.defaultValue.trim() : null,
          references:
            c.showFk && c.references?.table && c.references?.column
              ? c.references
              : null,
        })),
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
      const createdName = res.table;
      resetForm();
      onCreated(createdName);
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Failed to create table.");
    },
  });

  const updateColumn = (id: string, patch: Partial<ColumnDraft>) => {
    setColumns((prev) =>
      prev.map((col) => {
        if (col.id !== id) return col;
        const updated = { ...col, ...patch };
        if (patch.type && patch.type !== "INTEGER" && updated.autoIncrement) {
          updated.autoIncrement = false;
        }
        if (patch.autoIncrement && updated.autoIncrement) {
          updated.type = "INTEGER";
          updated.primaryKey = true;
        }
        return updated;
      }),
    );
  };

  const removeColumn = (id: string) => {
    setColumns((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
  };

  const applyTemplate = (kind: "users" | "kv" | "events") => {
    if (kind === "users") {
      setTableName("users");
      setColumns([
        makeColumnDraft({ name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true, notNull: true }),
        makeColumnDraft({ name: "email", type: "TEXT", notNull: true, unique: true }),
        makeColumnDraft({ name: "name", type: "TEXT", notNull: true }),
        makeColumnDraft({ name: "role", type: "TEXT", notNull: true, defaultValue: "'member'" }),
        makeColumnDraft({ name: "created_at", type: "DATETIME", notNull: true, defaultValue: "CURRENT_TIMESTAMP" }),
      ]);
    } else if (kind === "kv") {
      setTableName("key_value_store");
      setColumns([
        makeColumnDraft({ name: "key", type: "TEXT", primaryKey: true, notNull: true }),
        makeColumnDraft({ name: "value", type: "JSON", notNull: true, defaultValue: "'{}'" }),
        makeColumnDraft({ name: "updated_at", type: "DATETIME", notNull: true, defaultValue: "CURRENT_TIMESTAMP" }),
      ]);
    } else {
      setTableName("audit_events");
      setColumns([
        makeColumnDraft({ name: "id", type: "INTEGER", primaryKey: true, autoIncrement: true, notNull: true }),
        makeColumnDraft({ name: "event_type", type: "TEXT", notNull: true }),
        makeColumnDraft({ name: "payload", type: "JSON" }),
        makeColumnDraft({ name: "created_at", type: "DATETIME", notNull: true, defaultValue: "CURRENT_TIMESTAMP" }),
      ]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!tableName.trim()) {
      setError("Please enter a table name.");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      setError("Every column must have a name.");
      return;
    }
    mutation.mutate();
  };

  const sqlPreview = React.useMemo(
    () => previewCreateSql(tableName, columns, strictMode),
    [tableName, columns, strictMode],
  );

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? undefined : onClose}
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          sx: {
            borderRadius: "14px",
            maxHeight: "90vh",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          py: 2,
          px: 2.5,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              display: "flex",
              width: 34,
              height: 34,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              bgcolor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <Table2 size={18} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>Create New Table</Typography>
            <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              Design columns, primary keys, defaults, and foreign key relations visually
            </Typography>
          </Box>
        </Stack>
        <IconButton size="small" onClick={onClose} disabled={mutation.isPending}>
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <DialogContent sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2.5 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ fontSize: 12.5 }}>
              {error}
            </Alert>
          )}

          {/* Table Name & Quick Templates */}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ alignItems: { sm: "flex-end" }, justifyContent: "space-between" }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.75, color: "var(--foreground)" }}>
                Table Name
              </Typography>
              <TextField
                size="small"
                fullWidth
                autoFocus
                placeholder="e.g. users, orders, products"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                slotProps={{
                  input: {
                    sx: { fontFamily: "var(--font-mono)", fontSize: 13 },
                  },
                }}
              />
            </Box>

            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 0.5 }}>
                <Sparkles size={13} /> Presets:
              </Typography>
              <Chip
                label="Users"
                size="small"
                variant="outlined"
                onClick={() => applyTemplate("users")}
                sx={{ cursor: "pointer", fontSize: 11.5 }}
              />
              <Chip
                label="Key-Value"
                size="small"
                variant="outlined"
                onClick={() => applyTemplate("kv")}
                sx={{ cursor: "pointer", fontSize: 11.5 }}
              />
              <Chip
                label="Audit Events"
                size="small"
                variant="outlined"
                onClick={() => applyTemplate("events")}
                sx={{ cursor: "pointer", fontSize: 11.5 }}
              />
            </Stack>
          </Stack>

          <Divider />

          {/* Columns Header */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                Columns ({columns.length})
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                Define the schema for your SQLite table
              </Typography>
            </Box>
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<Plus size={14} />}
              onClick={() => setColumns((prev) => [...prev, makeColumnDraft()])}
              sx={{ height: 30, fontSize: 12 }}
            >
              Add Column
            </Button>
          </Box>

          {/* Column List */}
          <Stack spacing={1.25}>
            {columns.map((col, idx) => {
              const refTableCols =
                col.references?.table && schemaQuery.data?.[col.references.table]
                  ? schemaQuery.data[col.references.table]
                  : [];

              return (
                <Paper
                  key={col.id}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: "10px",
                    bgcolor: "var(--background)",
                    borderColor: col.primaryKey ? "rgba(56, 189, 248, 0.45)" : "var(--border)",
                  }}
                >
                  <Stack spacing={1.25}>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "1fr",
                          sm: "minmax(150px, 1.4fr) minmax(120px, 1fr) minmax(140px, 1.2fr) auto",
                        },
                        gap: 1.25,
                        alignItems: "center",
                      }}
                    >
                      {/* Column Name */}
                      <TextField
                        size="small"
                        placeholder={`column_${idx + 1}`}
                        label="Name"
                        value={col.name}
                        onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                        slotProps={{
                          input: {
                            sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 },
                          },
                        }}
                      />

                      {/* Type */}
                      <TextField
                        select
                        size="small"
                        label="Type"
                        value={col.type}
                        onChange={(e) => updateColumn(col.id, { type: e.target.value })}
                        slotProps={{
                          input: {
                            sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 },
                          },
                        }}
                      >
                        {COLUMN_TYPES.map((t) => (
                          <MenuItem key={t} value={t} sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                            {t}
                          </MenuItem>
                        ))}
                      </TextField>

                      {/* Default Value */}
                      <TextField
                        size="small"
                        label="Default (optional)"
                        placeholder="NULL, 0, 'text', CURRENT_TIMESTAMP"
                        value={col.defaultValue ?? ""}
                        onChange={(e) => updateColumn(col.id, { defaultValue: e.target.value })}
                        disabled={Boolean(col.primaryKey && col.autoIncrement)}
                        slotProps={{
                          input: {
                            sx: { fontFamily: "var(--font-mono)", fontSize: 12 },
                          },
                        }}
                      />

                      {/* Actions */}
                      <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                        <Tooltip title="Foreign Key Reference">
                          <IconButton
                            size="small"
                            onClick={() =>
                              updateColumn(col.id, {
                                showFk: !col.showFk,
                                references: !col.showFk
                                  ? col.references ?? {
                                      table: existingTables[0] ?? "",
                                      column: "id",
                                      onDelete: "CASCADE",
                                    }
                                  : null,
                              })
                            }
                            sx={{
                              color: col.showFk ? "var(--primary)" : "var(--muted-foreground)",
                              bgcolor: col.showFk ? "rgba(56, 189, 248, 0.12)" : "transparent",
                            }}
                          >
                            <Link2 size={15} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove column">
                          <span>
                            <IconButton
                              size="small"
                              disabled={columns.length <= 1}
                              onClick={() => removeColumn(col.id)}
                              sx={{ color: "var(--muted-foreground)", "&:hover": { color: "var(--destructive)" } }}
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Box>

                    {/* Constraints Row */}
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: "center", flexWrap: "wrap", pt: 0.25 }}
                    >
                      <FormControlLabel
                        sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                        control={
                          <Checkbox
                            size="small"
                            checked={Boolean(col.primaryKey)}
                            onChange={(e) =>
                              updateColumn(col.id, {
                                primaryKey: e.target.checked,
                                notNull: e.target.checked ? true : col.notNull,
                                autoIncrement: e.target.checked ? col.autoIncrement : false,
                              })
                            }
                          />
                        }
                        label={
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <KeyRound size={12} color={col.primaryKey ? "#f5a524" : "currentColor"} />
                            <span>Primary Key</span>
                          </Stack>
                        }
                      />

                      {col.primaryKey && col.type === "INTEGER" && (
                        <FormControlLabel
                          sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                          control={
                            <Checkbox
                              size="small"
                              checked={Boolean(col.autoIncrement)}
                              onChange={(e) => updateColumn(col.id, { autoIncrement: e.target.checked })}
                            />
                          }
                          label="Autoincrement"
                        />
                      )}

                      <FormControlLabel
                        sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                        control={
                          <Checkbox
                            size="small"
                            checked={Boolean(col.notNull || col.primaryKey)}
                            disabled={Boolean(col.primaryKey)}
                            onChange={(e) => updateColumn(col.id, { notNull: e.target.checked })}
                          />
                        }
                        label="Not Null"
                      />

                      <FormControlLabel
                        sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
                        control={
                          <Checkbox
                            size="small"
                            checked={Boolean(col.unique)}
                            disabled={Boolean(col.primaryKey)}
                            onChange={(e) => updateColumn(col.id, { unique: e.target.checked })}
                          />
                        }
                        label="Unique"
                      />

                      {/* Quick default chips */}
                      {!col.primaryKey && (DEFAULT_SUGGESTIONS[col.type]?.length ?? 0) > 0 && (
                        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", ml: "auto" }}>
                          <Typography sx={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            Quick default:
                          </Typography>
                          {DEFAULT_SUGGESTIONS[col.type]!.map((sug) => (
                            <Chip
                              key={sug}
                              label={sug}
                              size="small"
                              onClick={() => updateColumn(col.id, { defaultValue: sug })}
                              sx={{
                                height: 20,
                                fontSize: 10.5,
                                fontFamily: "var(--font-mono)",
                                cursor: "pointer",
                              }}
                            />
                          ))}
                        </Stack>
                      )}
                    </Stack>

                    {/* Foreign Key Collapse */}
                    <Collapse in={col.showFk}>
                      <Box
                        sx={{
                          mt: 0.75,
                          p: 1.25,
                          borderRadius: "8px",
                          bgcolor: "var(--muted)",
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr 1fr" },
                          gap: 1.25,
                        }}
                      >
                        <TextField
                          select
                          size="small"
                          label="References Table"
                          value={col.references?.table ?? ""}
                          onChange={(e) => {
                            const nextTable = e.target.value;
                            const firstCol = schemaQuery.data?.[nextTable]?.[0]?.name ?? "id";
                            updateColumn(col.id, {
                              references: {
                                table: nextTable,
                                column: firstCol,
                                onDelete: col.references?.onDelete ?? "CASCADE",
                              },
                            });
                          }}
                        >
                          {existingTables.length === 0 ? (
                            <MenuItem value="" disabled>
                              No existing tables
                            </MenuItem>
                          ) : (
                            existingTables.map((t) => (
                              <MenuItem key={t} value={t} sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                                {t}
                              </MenuItem>
                            ))
                          )}
                        </TextField>

                        <TextField
                          select={refTableCols.length > 0}
                          size="small"
                          label="References Column"
                          value={col.references?.column ?? ""}
                          onChange={(e) =>
                            updateColumn(col.id, {
                              references: {
                                table: col.references?.table ?? "",
                                column: e.target.value,
                                onDelete: col.references?.onDelete ?? "CASCADE",
                              },
                            })
                          }
                        >
                          {refTableCols.map((rc) => (
                            <MenuItem key={rc.name} value={rc.name} sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                              {rc.name} ({rc.type})
                            </MenuItem>
                          ))}
                        </TextField>

                        <TextField
                          select
                          size="small"
                          label="On Delete"
                          value={col.references?.onDelete ?? "CASCADE"}
                          onChange={(e) =>
                            updateColumn(col.id, {
                              references: {
                                table: col.references?.table ?? "",
                                column: col.references?.column ?? "id",
                                onDelete: e.target.value as NonNullable<
                                  CreateColumnInput["references"]
                                >["onDelete"],
                              },
                            })
                          }
                        >
                          {["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"].map((act) => (
                            <MenuItem key={act} value={act} sx={{ fontSize: 12 }}>
                              {act}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Box>
                    </Collapse>
                  </Stack>
                </Paper>
              );
            })}
          </Stack>

          {/* Table Options & SQL Preview */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
              <FormControlLabel
                sx={{ "& .MuiFormControlLabel-label": { fontSize: 12, color: "var(--muted-foreground)" } }}
                control={
                  <Switch
                    size="small"
                    checked={strictMode}
                    onChange={(e) => setStrictMode(e.target.checked)}
                  />
                }
                label="SQLite STRICT table (enforces rigid column types)"
              />

              <Button
                type="button"
                variant="text"
                size="small"
                startIcon={<Code2 size={14} />}
                onClick={() => setShowSqlPreview((s) => !s)}
                sx={{ fontSize: 12 }}
              >
                {showSqlPreview ? "Hide SQL Preview" : "Show SQL Preview"}
              </Button>
            </Stack>

            <Collapse in={showSqlPreview}>
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  borderRadius: "8px",
                  bgcolor: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  overflowX: "auto",
                  color: "var(--foreground)",
                }}
              >
                {sqlPreview}
              </Paper>
            </Collapse>
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            px: 2.5,
            py: 1.75,
            borderTop: "1px solid var(--border)",
            justifyContent: "space-between",
          }}
        >
          <Button type="button" variant="text" size="small" onClick={resetForm} disabled={mutation.isPending}>
            Reset
          </Button>
          <Stack direction="row" spacing={1}>
            <Button type="button" variant="outlined" size="small" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="small"
              disabled={mutation.isPending || !tableName.trim()}
              startIcon={mutation.isPending ? <CircularProgress size={14} color="inherit" /> : <Plus size={15} />}
            >
              {mutation.isPending ? "Creating Table…" : "Create Table"}
            </Button>
          </Stack>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
