"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { KeyRound, Pencil, Plus, X } from "lucide-react";
import { studioApi } from "@/lib/studio-api";
import type { StudioCellValue, StudioColumn } from "@/lib/studio/types";
import { parseCellInput } from "@/components/studio/format";

interface FieldDraft {
  mode: "value" | "null" | "default";
  value: string;
}

interface RowEditorDialogProps {
  open: boolean;
  mode: "insert" | "edit";
  table: string;
  columns: StudioColumn[];
  initialRow?: Record<string, StudioCellValue>;
  identity?: Record<string, StudioCellValue> | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RowEditorDialog({
  open,
  mode,
  table,
  columns,
  initialRow,
  identity,
  onClose,
  onSuccess,
}: RowEditorDialogProps) {
  const queryClient = useQueryClient();
  const [fields, setFields] = React.useState<Record<string, FieldDraft>>({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);

    const next: Record<string, FieldDraft> = {};
    for (const col of columns) {
      if (mode === "edit" && initialRow) {
        const val = initialRow[col.name];
        if (val === null || val === undefined) {
          next[col.name] = { mode: "null", value: "" };
        } else {
          next[col.name] = { mode: "value", value: String(val) };
        }
      } else {
        // Insert mode: if PK integer or has defaultValue, default to "default"
        if (col.pk && col.type.toUpperCase().includes("INT")) {
          next[col.name] = { mode: "default", value: "" };
        } else if (col.defaultValue !== null) {
          next[col.name] = { mode: "default", value: "" };
        } else if (!col.notNull) {
          next[col.name] = { mode: "null", value: "" };
        } else {
          next[col.name] = { mode: "value", value: "" };
        }
      }
    }
    setFields(next);
  }, [open, mode, columns, initialRow]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "insert") {
        const rowPayload: Record<string, StudioCellValue> = {};
        for (const col of columns) {
          const draft = fields[col.name];
          if (!draft || draft.mode === "default") continue;
          rowPayload[col.name] = parseCellInput(draft.value, col.type, draft.mode === "null");
        }
        return studioApi.insertRow({ table, row: rowPayload });
      } else {
        if (!identity) {
          throw new Error("Row identity is missing; cannot update this row.");
        }
        const changes: Record<string, StudioCellValue> = {};
        for (const col of columns) {
          const draft = fields[col.name];
          if (!draft || draft.mode === "default") continue;
          const nextVal = parseCellInput(draft.value, col.type, draft.mode === "null");
          const prevVal = initialRow?.[col.name] ?? null;
          if (nextVal !== prevVal) {
            changes[col.name] = nextVal;
          }
        }
        if (Object.keys(changes).length === 0) {
          return { rowsAffected: 0 };
        }
        return studioApi.updateRow({ table, identity, changes });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
      onSuccess?.();
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Operation failed.");
    },
  });

  const updateField = (colName: string, patch: Partial<FieldDraft>) => {
    setFields((prev) => ({
      ...prev,
      [colName]: { ...(prev[colName] ?? { mode: "value", value: "" }), ...patch },
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={mutation.isPending ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: { borderRadius: "14px", maxHeight: "90vh" },
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
            {mode === "insert" ? <Plus size={18} /> : <Pencil size={16} />}
          </Box>
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              {mode === "insert" ? `Insert Row into "${table}"` : `Edit Row in "${table}"`}
            </Typography>
            <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {mode === "insert"
                ? "Provide values or use column defaults / NULL"
                : "Modify column values for the selected record"}
            </Typography>
          </Box>
        </Stack>
        <IconButton size="small" onClick={onClose} disabled={mutation.isPending}>
          <X size={18} />
        </IconButton>
      </DialogTitle>

      <Box component="form" onSubmit={handleSubmit} sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <DialogContent sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ fontSize: 12.5 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={1.5}>
            {columns.map((col) => {
              const draft = fields[col.name] ?? { mode: "value", value: "" };
              const upperType = (col.type || "TEXT").toUpperCase();
              const isBoolean = upperType.includes("BOOL");
              const isMultiline =
                upperType.includes("TEXT") ||
                upperType.includes("JSON") ||
                draft.value.length > 60;
              const canUseDefault =
                mode === "insert" &&
                (col.defaultValue !== null || (col.pk && upperType.includes("INT")));

              return (
                <Paper
                  key={col.name}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: "10px",
                    bgcolor: "var(--background)",
                  }}
                >
                  <Stack spacing={1}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                        {col.pk && <KeyRound size={13} color="#f5a524" />}
                        <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
                          {col.name}
                        </Typography>
                        <Chip
                          label={col.type || "ANY"}
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: 10,
                            fontFamily: "var(--font-mono)",
                            bgcolor: "var(--muted)",
                          }}
                        />
                        {col.notNull && !col.pk && (
                          <Chip
                            label="NOT NULL"
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: 9.5,
                              color: "var(--warning)",
                              bgcolor: "rgba(245, 165, 36, 0.12)",
                            }}
                          />
                        )}
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        {canUseDefault && (
                          <FormControlLabel
                            sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 11.5, color: "var(--muted-foreground)" } }}
                            control={
                              <Checkbox
                                size="small"
                                checked={draft.mode === "default"}
                                onChange={(e) =>
                                  updateField(col.name, {
                                    mode: e.target.checked ? "default" : "value",
                                  })
                                }
                              />
                            }
                            label={
                              col.pk && upperType.includes("INT")
                                ? "Auto ID"
                                : `Default (${col.defaultValue})`
                            }
                          />
                        )}

                        {(!col.notNull || mode === "edit") && (
                          <FormControlLabel
                            sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 11.5, color: "var(--muted-foreground)" } }}
                            control={
                              <Checkbox
                                size="small"
                                checked={draft.mode === "null"}
                                onChange={(e) =>
                                  updateField(col.name, {
                                    mode: e.target.checked ? "null" : "value",
                                  })
                                }
                              />
                            }
                            label="NULL"
                          />
                        )}
                      </Stack>
                    </Box>

                    {draft.mode === "default" ? (
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          borderRadius: "6px",
                          bgcolor: "var(--muted)",
                          fontSize: 12,
                          fontStyle: "italic",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        Will use database default{" "}
                        {col.defaultValue ? `(${col.defaultValue})` : "(auto-generated)"}
                      </Box>
                    ) : draft.mode === "null" ? (
                      <Box
                        sx={{
                          px: 1.25,
                          py: 0.75,
                          borderRadius: "6px",
                          bgcolor: "var(--muted)",
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                          fontStyle: "italic",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        NULL
                      </Box>
                    ) : isBoolean ? (
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={draft.value || "0"}
                        onChange={(e) => updateField(col.name, { mode: "value", value: e.target.value })}
                      >
                        <MenuItem value="1">true (1)</MenuItem>
                        <MenuItem value="0">false (0)</MenuItem>
                      </TextField>
                    ) : (
                      <TextField
                        size="small"
                        fullWidth
                        multiline={isMultiline}
                        minRows={isMultiline ? 2 : 1}
                        maxRows={6}
                        placeholder={`Enter ${col.type || "value"}...`}
                        value={draft.value}
                        onChange={(e) => updateField(col.name, { mode: "value", value: e.target.value })}
                        slotProps={{
                          input: {
                            sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 },
                          },
                        }}
                      />
                    )}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.75, borderTop: "1px solid var(--border)" }}>
          <Button type="button" variant="outlined" size="small" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={mutation.isPending}
            startIcon={
              mutation.isPending ? (
                <CircularProgress size={14} color="inherit" />
              ) : mode === "insert" ? (
                <Plus size={15} />
              ) : (
                <Pencil size={14} />
              )
            }
          >
            {mutation.isPending
              ? mode === "insert"
                ? "Inserting…"
                : "Saving…"
              : mode === "insert"
                ? "Insert Row"
                : "Save Changes"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
