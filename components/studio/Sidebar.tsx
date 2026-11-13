"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Code2,
  Edit3,
  Eraser,
  Layers,
  ListTree,
  MoreHorizontal,
  Plus,
  Search,
  Table2,
  Terminal,
  Trash2,
} from "lucide-react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { studioApi } from "@/lib/studio-api";
import { useStudioStore } from "@/stores/studio-store";
import type { StudioTableInfo } from "@/lib/studio/types";

interface SidebarProps {
  onCreateTable: () => void;
}

export function Sidebar({ onCreateTable }: SidebarProps) {
  const queryClient = useQueryClient();
  const openTable = useStudioStore((s) => s.openTable);
  const openSchemaOverview = useStudioStore((s) => s.openSchemaOverview);
  const openQuery = useStudioStore((s) => s.openQuery);
  const newQuery = useStudioStore((s) => s.newQuery);
  const closeTableTab = useStudioStore((s) => s.closeTableTab);
  const renameTableTab = useStudioStore((s) => s.renameTableTab);
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);

  const [filter, setFilter] = React.useState("");
  const [menuState, setMenuState] = React.useState<{
    anchorEl: HTMLElement;
    table: StudioTableInfo;
  } | null>(null);

  const [renameDialog, setRenameDialog] = React.useState<{
    open: boolean;
    oldName: string;
    newName: string;
  }>({ open: false, oldName: "", newName: "" });

  const [confirmAction, setConfirmAction] = React.useState<{
    open: boolean;
    kind: "truncate" | "drop";
    table: string;
    confirmInput: string;
  }>({ open: false, kind: "drop", table: "", confirmInput: "" });

  const [toast, setToast] = React.useState<{ message: string; severity: "success" | "error" } | null>(
    null,
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeTable = activeTab?.kind === "table" ? activeTab.table : undefined;
  const isSchemaActive = activeTab?.kind === "schema";

  const { data: tables, isPending } = useQuery({
    queryKey: ["studio", "tables"],
    queryFn: () => studioApi.tables(),
    staleTime: 30_000,
  });

  const filtered = React.useMemo(() => {
    if (!tables) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, filter]);

  const renameMutation = useMutation({
    mutationFn: ({ oldName, newName }: { oldName: string; newName: string }) =>
      studioApi.renameTable({ table: oldName, newName }),
    onSuccess: (res) => {
      renameTableTab(res.oldName, res.newName);
      setRenameDialog({ open: false, oldName: "", newName: "" });
      setToast({
        message: `Renamed "${res.oldName}" to "${res.newName}".`,
        severity: "success",
      });
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
    },
    onError: (err) => {
      setToast({
        message: err instanceof Error ? err.message : "Failed to rename table.",
        severity: "error",
      });
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ kind, table }: { kind: "truncate" | "drop"; table: string }) => {
      if (kind === "drop") {
        await studioApi.dropTable(table);
        return { kind, table };
      } else {
        await studioApi.truncateTable(table);
        return { kind, table };
      }
    },
    onSuccess: ({ kind, table }) => {
      setConfirmAction({ open: false, kind: "drop", table: "", confirmInput: "" });
      if (kind === "drop") {
        closeTableTab(table);
        setToast({ message: `Dropped table "${table}".`, severity: "success" });
      } else {
        setToast({ message: `Truncated all rows from "${table}".`, severity: "success" });
        void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
      }
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
    },
    onError: (err) => {
      setToast({
        message: err instanceof Error ? err.message : "Action failed.",
        severity: "error",
      });
    },
  });

  return (
    <Box
      sx={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        flexDirection: "column",
        bgcolor: "var(--card)",
      }}
    >
      {/* Top Quick Actions */}
      <Stack spacing={1} sx={{ p: 1.25, borderBottom: "1px solid var(--border)" }}>
        <Stack direction="row" spacing={0.75}>
          <Button
            type="button"
            variant="contained"
            size="small"
            fullWidth
            startIcon={<Plus size={14} />}
            onClick={onCreateTable}
            sx={{ height: 30, fontSize: 12 }}
          >
            New Table
          </Button>
          <Button
            type="button"
            variant="outlined"
            size="small"
            fullWidth
            startIcon={<Terminal size={14} />}
            onClick={newQuery}
            sx={{ height: 30, fontSize: 12 }}
          >
            SQL Query
          </Button>
        </Stack>

        <Button
          type="button"
          variant="text"
          size="small"
          fullWidth
          startIcon={<Layers size={14} />}
          onClick={openSchemaOverview}
          sx={{
            height: 30,
            justifyContent: "flex-start",
            px: 1.25,
            fontSize: 12,
            borderRadius: "6px",
            bgcolor: isSchemaActive ? "var(--accent)" : "transparent",
            color: isSchemaActive ? "var(--foreground)" : "var(--muted-foreground)",
            "&:hover": {
              bgcolor: "var(--accent)",
              color: "var(--foreground)",
            },
          }}
        >
          Schema Explorer
        </Button>

        <TextField
          size="small"
          fullWidth
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search tables..."
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search style={{ width: 13, height: 13, color: "var(--muted-foreground)" }} />
                </InputAdornment>
              ),
              sx: { height: 30, fontSize: 12, bgcolor: "var(--background)" },
            },
          }}
        />
      </Stack>

      {/* Section Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
           pt: 1.25,
          pb: 0.5,
        }}
      >
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--muted-foreground)",
          }}
        >
          Tables {tables ? `(${tables.length})` : ""}
        </Typography>
      </Box>

      {/* Table List */}
      <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: 1, pb: 1.5 }}>
        {isPending ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={18} sx={{ color: "var(--muted-foreground)" }} />
          </Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ px: 1, py: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mb: 1.5 }}>
              {tables && tables.length === 0
                ? "No tables in this database yet."
                : "No tables match your search."}
            </Typography>
            {tables && tables.length === 0 && (
              <Button
                type="button"
                variant="outlined"
                size="small"
                startIcon={<Plus size={13} />}
                onClick={onCreateTable}
                sx={{ fontSize: 11.5 }}
              >
                Create First Table
              </Button>
            )}
          </Box>
        ) : (
          <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {filtered.map((table) => {
              const active = activeTable === table.name;
              return (
                <Box
                  component="li"
                  key={table.name}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    borderRadius: "8px",
                    bgcolor: active ? "var(--accent)" : "transparent",
                    color: active ? "var(--foreground)" : "var(--muted-foreground)",
                    "&:hover": {
                      bgcolor: "var(--accent)",
                      color: "var(--foreground)",
                    },
                    "&:hover .table-more-btn": {
                      opacity: 1,
                    },
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    onClick={() => openTable(table.name)}
                    title={`${table.name} · ${table.rowCount ?? 0} rows · ${table.columnCount} columns`}
                    sx={{
                      display: "flex",
                      flex: 1,
                      minWidth: 0,
                      alignItems: "center",
                      gap: 1,
                      border: 0,
                      bgcolor: "transparent",
                      color: "inherit",
                      px: 1,
                      py: 0.75,
                      textAlign: "left",
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                    }}
                  >
                    <Table2
                      style={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        color: active ? "var(--primary)" : "var(--muted-foreground)",
                      }}
                    />
                    <Box
                      component="span"
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12.5,
                      }}
                    >
                      {table.name}
                    </Box>
                    <Tooltip title={`${table.rowCount ?? 0} rows · ${table.columnCount} cols`}>
                      <Box
                        component="span"
                        sx={{
                          flexShrink: 0,
                          px: 0.6,
                          py: 0.1,
                          borderRadius: "4px",
                          bgcolor: "var(--background)",
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono)",
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        {(table.rowCount ?? 0).toLocaleString()}
                      </Box>
                    </Tooltip>
                  </Box>

                  <IconButton
                    className="table-more-btn"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuState({ anchorEl: e.currentTarget, table });
                    }}
                    sx={{
                      mr: 0.5,
                      width: 24,
                      height: 24,
                      opacity: { xs: 1, md: 0 },
                      transition: "opacity 0.12s",
                      color: "inherit",
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </IconButton>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>

      {/* Table Context Menu */}
      <Menu
        anchorEl={menuState?.anchorEl}
        open={Boolean(menuState)}
        onClose={() => setMenuState(null)}
      >
        <MenuItem
          onClick={() => {
            if (menuState) openTable(menuState.table.name, "data");
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5 }}
        >
          <ListItemIcon>
            <Table2 size={15} />
          </ListItemIcon>
          Browse Data
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuState) openTable(menuState.table.name, "structure");
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5 }}
        >
          <ListItemIcon>
            <ListTree size={15} />
          </ListItemIcon>
          View Structure
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuState) openTable(menuState.table.name, "ddl");
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5 }}
        >
          <ListItemIcon>
            <Code2 size={15} />
          </ListItemIcon>
          View DDL SQL
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuState) {
              openQuery(
                `SELECT * FROM "${menuState.table.name.replace(/"/g, '""')}" LIMIT 100;`,
                `Query ${menuState.table.name}`,
              );
            }
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5 }}
        >
          <ListItemIcon>
            <Terminal size={15} />
          </ListItemIcon>
          Query in SQL Editor
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            if (menuState) {
              setRenameDialog({
                open: true,
                oldName: menuState.table.name,
                newName: menuState.table.name,
              });
            }
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5 }}
        >
          <ListItemIcon>
            <Edit3 size={15} />
          </ListItemIcon>
          Rename Table
        </MenuItem>

        <MenuItem
          onClick={() => {
            if (menuState) {
              setConfirmAction({
                open: true,
                kind: "truncate",
                table: menuState.table.name,
                confirmInput: "",
              });
            }
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5, color: "var(--warning)" }}
        >
          <ListItemIcon sx={{ color: "var(--warning)" }}>
            <Eraser size={15} />
          </ListItemIcon>
          Truncate Rows
        </MenuItem>

        <MenuItem
          onClick={() => {
            if (menuState) {
              setConfirmAction({
                open: true,
                kind: "drop",
                table: menuState.table.name,
                confirmInput: "",
              });
            }
            setMenuState(null);
          }}
          sx={{ fontSize: 12.5, color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "var(--destructive)" }}>
            <Trash2 size={15} />
          </ListItemIcon>
          Drop Table
        </MenuItem>
      </Menu>

      {/* Rename Table Dialog */}
      <Dialog
        open={renameDialog.open}
        onClose={
          renameMutation.isPending
            ? undefined
            : () => setRenameDialog({ open: false, oldName: "", newName: "" })
        }
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          Rename Table &ldquo;{renameDialog.oldName}&rdquo;
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            label="New Table Name"
            value={renameDialog.newName}
            onChange={(e) =>
              setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))
            }
            sx={{ mt: 1 }}
            slotProps={{ input: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setRenameDialog({ open: false, oldName: "", newName: "" })}
            disabled={renameMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            size="small"
            disabled={
              !renameDialog.newName.trim() ||
              renameDialog.newName.trim() === renameDialog.oldName ||
              renameMutation.isPending
            }
            onClick={() =>
              renameMutation.mutate({
                oldName: renameDialog.oldName,
                newName: renameDialog.newName.trim(),
              })
            }
          >
            {renameMutation.isPending ? "Renaming…" : "Rename"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Truncate / Drop Confirmation Dialog */}
      <Dialog
        open={confirmAction.open}
        onClose={
          actionMutation.isPending
            ? undefined
            : () => setConfirmAction({ open: false, kind: "drop", table: "", confirmInput: "" })
        }
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          {confirmAction.kind === "drop"
            ? `Drop Table "${confirmAction.table}"?`
            : `Truncate Table "${confirmAction.table}"?`}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            {confirmAction.kind === "drop" ? (
              <>
                This will permanently delete the table{" "}
                <Box component="strong" sx={{ color: "var(--foreground)" }}>
                  {confirmAction.table}
                </Box>{" "}
                and all of its data and indexes.
              </>
            ) : (
              <>
                This will permanently delete all rows inside{" "}
                <Box component="strong" sx={{ color: "var(--foreground)" }}>
                  {confirmAction.table}
                </Box>{" "}
                while keeping the table structure intact.
              </>
            )}
          </Typography>

          <Box>
            <Typography sx={{ fontSize: 12, mb: 0.75, color: "var(--muted-foreground)" }}>
              Type{" "}
              <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                {confirmAction.table}
              </Box>{" "}
              to confirm:
            </Typography>
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder={confirmAction.table}
              value={confirmAction.confirmInput}
              onChange={(e) =>
                setConfirmAction((prev) => ({ ...prev, confirmInput: e.target.value }))
              }
              slotProps={{ input: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            disabled={actionMutation.isPending}
            onClick={() =>
              setConfirmAction({ open: false, kind: "drop", table: "", confirmInput: "" })
            }
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={
              confirmAction.confirmInput !== confirmAction.table ||
              actionMutation.isPending
            }
            onClick={() =>
              actionMutation.mutate({
                kind: confirmAction.kind,
                table: confirmAction.table,
              })
            }
          >
            {actionMutation.isPending
              ? "Processing…"
              : confirmAction.kind === "drop"
                ? "Drop Table"
                : "Truncate Rows"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3200}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert severity={toast.severity} onClose={() => setToast(null)} sx={{ fontSize: 12.5 }}>
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
