"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Code2,
  Copy,
  Database,
  Download,
  Filter,
  KeyRound,
  Link2,
  ListTree,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
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
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { StudioTab } from "@/stores/studio-store";
import { DEFAULT_TABLE_STATE, useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import type {
  StudioCellValue,
  StudioColumn,
  StudioFilterCondition,
  StudioFilterOperator,
  StudioTableDetails,
} from "@/lib/studio/types";
import { DataGrid } from "@/components/studio/DataGrid";
import { RowEditorDialog } from "@/components/studio/RowEditorDialog";
import { toCsv, toJsonExport, toSqlInserts } from "@/components/studio/format";

const FILTER_OPERATORS: Array<{ value: StudioFilterOperator; label: string; needsValue: boolean }> = [
  { value: "eq", label: "= equals", needsValue: true },
  { value: "neq", label: "!= not equals", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "starts_with", label: "starts with", needsValue: true },
  { value: "ends_with", label: "ends with", needsValue: true },
  { value: "gt", label: "> greater than", needsValue: true },
  { value: "gte", label: ">= greater or equal", needsValue: true },
  { value: "lt", label: "< less than", needsValue: true },
  { value: "lte", label: "<= less or equal", needsValue: true },
  { value: "is_null", label: "IS NULL", needsValue: false },
  { value: "is_not_null", label: "IS NOT NULL", needsValue: false },
];

export function TableView({ tab }: { tab: StudioTab }) {
  const table = tab.table!;
  const queryClient = useQueryClient();

  const rawTableState = useStudioStore((s) => s.tableStates[table]);
  const tableState = React.useMemo(
    () => ({
      ...DEFAULT_TABLE_STATE,
      ...rawTableState,
      filters: Array.isArray(rawTableState?.filters) ? rawTableState.filters : [],
      search: typeof rawTableState?.search === "string" ? rawTableState.search : "",
      pageSize: typeof rawTableState?.pageSize === "number" ? rawTableState.pageSize : 50,
    }),
    [rawTableState],
  );

  const setPage = useStudioStore((s) => s.setPage);
  const setPageSize = useStudioStore((s) => s.setPageSize);
  const setSort = useStudioStore((s) => s.setSort);
  const setView = useStudioStore((s) => s.setView);
  const setFilters = useStudioStore((s) => s.setFilters);
  const setSearch = useStudioStore((s) => s.setSearch);
  const openQuery = useStudioStore((s) => s.openQuery);

  const [searchInput, setSearchInput] = React.useState(tableState.search);
  const [filterBarOpen, setFilterBarOpen] = React.useState(tableState.filters.length > 0);
  const [selectedRows, setSelectedRows] = React.useState<Set<number>>(new Set());

  const [rowModal, setRowModal] = React.useState<{
    open: boolean;
    mode: "insert" | "edit";
    rowIndex?: number;
  }>({ open: false, mode: "insert" });

  const [deleteDialog, setDeleteDialog] = React.useState<{
    open: boolean;
    identities: Array<Record<string, StudioCellValue>>;
  }>({ open: false, identities: [] });

  const [exportAnchor, setExportAnchor] = React.useState<HTMLElement | null>(null);
  const [toast, setToast] = React.useState<{ message: string; severity: "success" | "error" } | null>(
    null,
  );

  // Debounce search input
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== tableState.search) {
        setSearch(table, searchInput);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [searchInput, tableState.search, setSearch, table]);

  const rowsQuery = useQuery({
    queryKey: [
      "studio",
      "rows",
      table,
      tableState.page,
      tableState.pageSize,
      tableState.sort,
      tableState.filters,
      tableState.search,
    ],
    queryFn: () =>
      studioApi.rows({
        table,
        page: tableState.page,
        pageSize: tableState.pageSize,
        sortColumn: tableState.sort?.column,
        sortDir: tableState.sort?.dir,
        filters: tableState.filters,
        search: tableState.search,
      }),
    placeholderData: (previous) => previous,
  });

  const detailsQuery = useQuery({
    queryKey: ["studio", "table_details", table],
    queryFn: () => studioApi.tableDetails(table),
    staleTime: 30_000,
  });

  // Reset selected rows when data/page changes
  React.useEffect(() => {
    setSelectedRows(new Set());
  }, [tableState.page, tableState.pageSize, tableState.sort, tableState.filters, tableState.search, table]);

  const deleteMutation = useMutation({
    mutationFn: (identities: Array<Record<string, StudioCellValue>>) =>
      studioApi.deleteRows({ table, identities }),
    onSuccess: (res) => {
      setDeleteDialog({ open: false, identities: [] });
      setSelectedRows(new Set());
      setToast({
        message: `Deleted ${res.rowsAffected} ${res.rowsAffected === 1 ? "row" : "rows"}.`,
        severity: "success",
      });
      void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
    },
    onError: (err) => {
      setToast({
        message: err instanceof Error ? err.message : "Failed to delete rows.",
        severity: "error",
      });
    },
  });

  const handleInlineCellUpdate = async (
    rowIndex: number,
    columnName: string,
    newValue: StudioCellValue,
  ) => {
    const identity = rowsQuery.data?.rowIdentities[rowIndex];
    if (!identity) {
      throw new Error("Cannot identify row for inline update.");
    }
    try {
      await studioApi.updateRow({
        table,
        identity,
        changes: { [columnName]: newValue },
      });
      setToast({ message: `Updated "${columnName}".`, severity: "success" });
      await queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed.";
      setToast({ message: msg, severity: "error" });
      throw err;
    }
  };

  const handleExport = (format: "csv" | "json" | "sql") => {
    setExportAnchor(null);
    const data = rowsQuery.data;
    if (!data) return;

    let content = "";
    let mime = "text/plain;charset=utf-8";
    let ext = "txt";

    if (format === "csv") {
      content = toCsv(data.columns, data.rows);
      mime = "text/csv;charset=utf-8";
      ext = "csv";
    } else if (format === "json") {
      content = toJsonExport(data.columns, data.rows);
      mime = "application/json;charset=utf-8";
      ext = "json";
    } else {
      content = toSqlInserts(table, data.columns, data.rows);
      mime = "application/sql;charset=utf-8";
      ext = "sql";
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const columns: StudioColumn[] =
    detailsQuery.data?.columns ?? rowsQuery.data?.columnTypes ?? [];

  const addFilterCondition = () => {
    const defaultCol = columns[0]?.name ?? "";
    if (!defaultCol) return;
    const next: StudioFilterCondition = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      column: defaultCol,
      operator: "eq",
      value: "",
    };
    setFilters(table, [...tableState.filters, next]);
    setFilterBarOpen(true);
  };

  const updateFilterCondition = (index: number, patch: Partial<StudioFilterCondition>) => {
    const next = tableState.filters.map((f, i) => (i === index ? { ...f, ...patch } : f));
    setFilters(table, next);
  };

  const removeFilterCondition = (index: number) => {
    const next = tableState.filters.filter((_, i) => i !== index);
    setFilters(table, next);
  };

  const editingRowRecord = React.useMemo(() => {
    if (rowModal.mode !== "edit" || rowModal.rowIndex === undefined || !rowsQuery.data) {
      return undefined;
    }
    const rowArr = rowsQuery.data.rows[rowModal.rowIndex];
    if (!rowArr) return undefined;
    const record: Record<string, StudioCellValue> = {};
    rowsQuery.data.columns.forEach((col, i) => {
      record[col] = rowArr[i] ?? null;
    });
    return record;
  }, [rowModal, rowsQuery.data]);

  const editingRowIdentity =
    rowModal.mode === "edit" && rowModal.rowIndex !== undefined
      ? rowsQuery.data?.rowIdentities[rowModal.rowIndex] ?? null
      : null;

  const selectedIdentities = React.useMemo(() => {
    if (!rowsQuery.data) return [];
    const list: Array<Record<string, StudioCellValue>> = [];
    selectedRows.forEach((idx) => {
      const id = rowsQuery.data?.rowIdentities[idx];
      if (id) list.push(id);
    });
    return list;
  }, [selectedRows, rowsQuery.data]);

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      {/* Top Action & View Switcher Bar */}
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
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, mr: 1 }}>
          <Database style={{ width: 16, height: 16, flexShrink: 0, color: "var(--primary)" }} />
          <Typography
            noWrap
            sx={{
              fontFamily: "var(--font-mono)",
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {table}
          </Typography>
          {rowsQuery.data && (
            <Chip
              size="small"
              label={`${rowsQuery.data.total.toLocaleString()} rows`}
              sx={{
                height: 20,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                bgcolor: "var(--muted)",
              }}
            />
          )}
        </Stack>

        {/* Segmented View Switcher */}
        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            borderRadius: "8px",
            border: "1px solid var(--border)",
            bgcolor: "var(--background)",
            p: 0.35,
          }}
        >
          {(["data", "structure", "ddl"] as const).map((v) => {
            const active = tableState.view === v;
            const label = v === "data" ? "Data" : v === "structure" ? "Structure" : "DDL";
            return (
              <Button
                key={v}
                type="button"
                size="small"
                variant={active ? "contained" : "text"}
                onClick={() => setView(table, v)}
                sx={{
                  minHeight: 24,
                  height: 24,
                  py: 0,
                  px: 1.25,
                  fontSize: 11.5,
                  borderRadius: "6px",
                }}
              >
                {label}
              </Button>
            );
          })}
        </Stack>

        <Box sx={{ flex: 1 }} />

        {/* Data View Toolbar Actions */}
        {tableState.view === "data" && (
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              size="small"
              placeholder="Search rows..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={13} color="var(--muted-foreground)" />
                    </InputAdornment>
                  ),
                  endAdornment: searchInput ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setSearchInput("");
                          setSearch(table, "");
                        }}
                        sx={{ p: 0.25 }}
                      >
                        <X size={12} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                  sx: {
                    height: 30,
                    fontSize: 12,
                    width: { xs: 140, sm: 190 },
                  },
                },
              }}
            />

            <Button
              type="button"
              variant={tableState.filters.length > 0 ? "contained" : "outlined"}
              size="small"
              startIcon={<Filter size={13} />}
              onClick={() => {
                if (tableState.filters.length === 0 && !filterBarOpen) {
                  addFilterCondition();
                } else {
                  setFilterBarOpen((o) => !o);
                }
              }}
              sx={{ height: 30, px: 1.25, fontSize: 12 }}
            >
              Filter{tableState.filters.length > 0 ? ` (${tableState.filters.length})` : ""}
            </Button>

            {selectedIdentities.length > 0 && (
              <Button
                type="button"
                variant="contained"
                color="error"
                size="small"
                startIcon={<Trash2 size={13} />}
                onClick={() =>
                  setDeleteDialog({ open: true, identities: selectedIdentities })
                }
                sx={{ height: 30, px: 1.25, fontSize: 12 }}
              >
                Delete ({selectedIdentities.length})
              </Button>
            )}

            <Button
              type="button"
              variant="contained"
              size="small"
              startIcon={<Plus size={14} />}
              onClick={() => setRowModal({ open: true, mode: "insert" })}
              sx={{ height: 30, px: 1.25, fontSize: 12 }}
            >
              Insert Row
            </Button>

            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<Download size={13} />}
              onClick={(e) => setExportAnchor(e.currentTarget)}
              disabled={!rowsQuery.data || rowsQuery.data.rows.length === 0}
              sx={{ height: 30, px: 1, fontSize: 12, display: { xs: "none", sm: "inline-flex" } }}
            >
              Export
            </Button>
          </Stack>
        )}

        <Tooltip title="Query this table in SQL Editor">
          <IconButton
            size="small"
            onClick={() =>
              openQuery(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 100;`, `Query ${table}`)
            }
            sx={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: "6px" }}
          >
            <Terminal size={14} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Refresh table data">
          <IconButton
            size="small"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
              void queryClient.invalidateQueries({ queryKey: ["studio", "table_details", table] });
              void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
            }}
            sx={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: "6px" }}
          >
            <RefreshCw size={14} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filter Builder Bar */}
      {tableState.view === "data" && (
        <Collapse in={filterBarOpen}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              borderBottom: "1px solid var(--border)",
              bgcolor: "var(--background)",
              px: 1.5,
              py: 1,
            }}
          >
            {tableState.filters.map((f, idx) => {
              const opMeta = FILTER_OPERATORS.find((o) => o.value === f.operator);
              const needsVal = opMeta ? opMeta.needsValue : true;

              return (
                <Stack
                  key={f.id ?? idx}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", flexWrap: "wrap" }}
                >
                  <Typography
                    sx={{
                      width: 48,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--muted-foreground)",
                      textTransform: "uppercase",
                    }}
                  >
                    {idx === 0 ? "Where" : "And"}
                  </Typography>

                  <TextField
                    select
                    size="small"
                    value={f.column}
                    onChange={(e) => updateFilterCondition(idx, { column: e.target.value })}
                    sx={{ minWidth: 140 }}
                    slotProps={{
                      input: { sx: { height: 28, fontSize: 12, fontFamily: "var(--font-mono)" } },
                    }}
                  >
                    {columns.map((c) => (
                      <MenuItem key={c.name} value={c.name} sx={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                        {c.name}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    size="small"
                    value={f.operator}
                    onChange={(e) =>
                      updateFilterCondition(idx, {
                        operator: e.target.value as StudioFilterOperator,
                      })
                    }
                    sx={{ minWidth: 145 }}
                    slotProps={{
                      input: { sx: { height: 28, fontSize: 12 } },
                    }}
                  >
                    {FILTER_OPERATORS.map((op) => (
                      <MenuItem key={op.value} value={op.value} sx={{ fontSize: 12 }}>
                        {op.label}
                      </MenuItem>
                    ))}
                  </TextField>

                  {needsVal && (
                    <TextField
                      size="small"
                      placeholder="Value..."
                      value={f.value ?? ""}
                      onChange={(e) => updateFilterCondition(idx, { value: e.target.value })}
                      sx={{ minWidth: 160, flex: 1, maxWidth: 280 }}
                      slotProps={{
                        input: { sx: { height: 28, fontSize: 12, fontFamily: "var(--font-mono)" } },
                      }}
                    />
                  )}

                  <IconButton
                    size="small"
                    onClick={() => removeFilterCondition(idx)}
                    sx={{ width: 26, height: 26, color: "var(--muted-foreground)" }}
                  >
                    <X size={14} />
                  </IconButton>
                </Stack>
              );
            })}

            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Button
                type="button"
                size="small"
                variant="text"
                startIcon={<Plus size={13} />}
                onClick={addFilterCondition}
                sx={{ height: 26, fontSize: 11.5 }}
              >
                Add condition
              </Button>
              {tableState.filters.length > 0 && (
                <Button
                  type="button"
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => {
                    setFilters(table, []);
                    setFilterBarOpen(false);
                  }}
                  sx={{ height: 26, fontSize: 11.5, color: "var(--muted-foreground)" }}
                >
                  Clear all
                </Button>
              )}
            </Stack>
          </Box>
        </Collapse>
      )}

      {/* Main Content Area */}
      {tableState.view === "structure" ? (
        <StructureView
          table={table}
          details={detailsQuery.data}
          isLoading={detailsQuery.isPending}
          onUpdated={(msg) => setToast({ message: msg, severity: "success" })}
          onError={(msg) => setToast({ message: msg, severity: "error" })}
        />
      ) : tableState.view === "ddl" ? (
        <DdlView table={table} sql={detailsQuery.data?.sql ?? null} />
      ) : (
        <Box sx={{ minHeight: 0, flex: 1 }}>
          {rowsQuery.isPending && !rowsQuery.data ? (
            <LoadingSkeleton />
          ) : rowsQuery.isError ? (
            <ErrorState message={rowsQuery.error.message} />
          ) : (
            <DataGrid
              columns={rowsQuery.data!.columns}
              columnTypes={rowsQuery.data!.columnTypes}
              rows={rowsQuery.data!.rows}
              rowIdentities={rowsQuery.data!.rowIdentities}
              canMutateRows={rowsQuery.data!.canMutateRows}
              selectedRows={selectedRows}
              onSelectedRowsChange={setSelectedRows}
              onInlineCellUpdate={handleInlineCellUpdate}
              onEditRow={(rowIndex) => setRowModal({ open: true, mode: "edit", rowIndex })}
              onDeleteRow={(rowIndex) => {
                const id = rowsQuery.data?.rowIdentities[rowIndex];
                if (id) {
                  setDeleteDialog({ open: true, identities: [id] });
                }
              }}
              sort={tableState.sort}
              onSort={(sort) => {
                setSort(table, sort);
                setPage(table, 0);
              }}
              pagination={{
                page: tableState.page,
                pageSize: tableState.pageSize,
                total: rowsQuery.data!.total,
                filteredTotal: rowsQuery.data!.filteredTotal,
                onPageChange: (page) => setPage(table, page),
                onPageSizeChange: (size) => setPageSize(table, size),
              }}
              emptyText={
                tableState.filters.length > 0 || tableState.search
                  ? "No rows match your current filters."
                  : `Table "${table}" has no rows yet.`
              }
              emptyAction={
                tableState.filters.length === 0 && !tableState.search ? (
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    startIcon={<Plus size={14} />}
                    onClick={() => setRowModal({ open: true, mode: "insert" })}
                  >
                    Insert First Row
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outlined"
                    size="small"
                    onClick={() => {
                      setFilters(table, []);
                      setSearchInput("");
                      setSearch(table, "");
                    }}
                  >
                    Reset Filters
                  </Button>
                )
              }
            />
          )}
        </Box>
      )}

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
        <MenuItem onClick={() => handleExport("sql")} sx={{ fontSize: 12.5 }}>
          Export as SQL INSERTs (.sql)
        </MenuItem>
      </Menu>

      {/* Row Insert / Edit Modal */}
      <RowEditorDialog
        open={rowModal.open}
        mode={rowModal.mode}
        table={table}
        columns={columns}
        initialRow={editingRowRecord}
        identity={editingRowIdentity}
        onClose={() => setRowModal((prev) => ({ ...prev, open: false }))}
        onSuccess={() =>
          setToast({
            message:
              rowModal.mode === "insert"
                ? `Inserted new row into "${table}".`
                : `Updated row in "${table}".`,
            severity: "success",
          })
        }
      />

      {/* Delete Rows Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={deleteMutation.isPending ? undefined : () => setDeleteDialog({ open: false, identities: [] })}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          Delete {deleteDialog.identities.length === 1 ? "Row" : `${deleteDialog.identities.length} Rows`}?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            Are you sure you want to permanently delete{" "}
            <Box component="strong" sx={{ color: "var(--foreground)" }}>
              {deleteDialog.identities.length}{" "}
              {deleteDialog.identities.length === 1 ? "record" : "records"}
            </Box>{" "}
            from <Box component="code">{table}</Box>? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            disabled={deleteMutation.isPending}
            onClick={() => setDeleteDialog({ open: false, identities: [] })}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            color="error"
            size="small"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate(deleteDialog.identities)}
            startIcon={deleteMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <Trash2 size={14} />}
          >
            {deleteMutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Feedback Snackbar */}
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

function StructureView({
  table,
  details,
  isLoading,
  onUpdated,
  onError,
}: {
  table: string;
  details?: StudioTableDetails;
  isLoading: boolean;
  onUpdated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [addColOpen, setAddColOpen] = React.useState(false);
  const [colName, setColName] = React.useState("");
  const [colType, setColType] = React.useState("TEXT");
  const [colNotNull, setColNotNull] = React.useState(false);
  const [colDefault, setColDefault] = React.useState("");
  const [dropColTarget, setDropColTarget] = React.useState<string | null>(null);

  const addColumnMutation = useMutation({
    mutationFn: () =>
      studioApi.addColumn({
        table,
        column: {
          name: colName.trim(),
          type: colType,
          notNull: colNotNull,
          defaultValue: colDefault.trim() ? colDefault.trim() : null,
        },
      }),
    onSuccess: (res) => {
      setAddColOpen(false);
      setColName("");
      setColType("TEXT");
      setColNotNull(false);
      setColDefault("");
      onUpdated(`Added column "${res.column}".`);
      void queryClient.invalidateQueries({ queryKey: ["studio", "table_details", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
    },
    onError: (err) => {
      onError(err instanceof Error ? err.message : "Failed to add column.");
    },
  });

  const dropColumnMutation = useMutation({
    mutationFn: (column: string) => studioApi.dropColumn({ table, column }),
    onSuccess: (res) => {
      setDropColTarget(null);
      onUpdated(`Dropped column "${res.column}".`);
      void queryClient.invalidateQueries({ queryKey: ["studio", "table_details", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "rows", table] });
      void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
    },
    onError: (err) => {
      setDropColTarget(null);
      onError(err instanceof Error ? err.message : "Failed to drop column.");
    },
  });

  if (isLoading && !details) {
    return <LoadingSkeleton />;
  }

  const columns = details?.columns ?? [];
  const foreignKeys = details?.foreignKeys ?? [];
  const indexes = details?.indexes ?? [];

  return (
    <Box sx={{ minHeight: 0, flex: 1, overflow: "auto", p: 2.5, display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Columns Section */}
      <Paper variant="outlined" sx={{ borderRadius: "10px", overflow: "hidden" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.5,
            borderBottom: "1px solid var(--border)",
            bgcolor: "var(--card)",
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
              Columns ({columns.length})
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
              Table columns, data types, constraints, and default expressions
            </Typography>
          </Box>
          <Button
            type="button"
            variant="outlined"
            size="small"
            startIcon={<Plus size={14} />}
            onClick={() => setAddColOpen(true)}
            sx={{ height: 28, fontSize: 12 }}
          >
            Add Column
          </Button>
        </Box>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                #
              </TableCell>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Column Name
              </TableCell>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Data Type
              </TableCell>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Nullable
              </TableCell>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Default Value
              </TableCell>
              <TableCell sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Primary Key
              </TableCell>
              <TableCell align="right" sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)" }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {columns.map((col) => (
              <TableRow key={col.name} hover>
                <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)" }}>
                  {col.cid}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    {col.pk ? (
                      <KeyRound size={13} color="#f5a524" />
                    ) : (
                      <ListTree size={13} color="var(--muted-foreground)" />
                    )}
                    <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
                      {col.name}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <Chip
                    label={col.type || "ANY"}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      bgcolor: "var(--muted)",
                    }}
                  />
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  {col.notNull || col.pk ? (
                    <Chip label="NOT NULL" size="small" sx={{ height: 20, fontSize: 10.5 }} />
                  ) : (
                    <Typography component="span" sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      Nullable
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)" }}>
                  {col.defaultValue ?? "—"}
                </TableCell>
                <TableCell sx={{ fontSize: 12 }}>
                  {col.pk ? (
                    <Chip
                      label={`PK #${col.pkOrder}`}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: 10.5,
                        color: "#f5a524",
                        bgcolor: "rgba(245, 165, 36, 0.14)",
                      }}
                    />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell align="right">
                  {!col.pk && columns.length > 1 && (
                    <Tooltip title="Drop column">
                      <IconButton
                        size="small"
                        onClick={() => setDropColTarget(col.name)}
                        sx={{ color: "var(--muted-foreground)", "&:hover": { color: "var(--destructive)" } }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* Foreign Keys & Indexes Grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" },
          gap: 2.5,
        }}
      >
        {/* Foreign Keys */}
        <Paper variant="outlined" sx={{ borderRadius: "10px", overflow: "hidden" }}>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: "1px solid var(--border)",
              bgcolor: "var(--card)",
            }}
          >
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
              Foreign Keys ({foreignKeys.length})
            </Typography>
          </Box>
          {foreignKeys.length === 0 ? (
            <Box sx={{ p: 2.5, fontSize: 12.5, color: "var(--muted-foreground)" }}>
              No foreign key constraints defined on this table.
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>Column</TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>References</TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>On Delete</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {foreignKeys.map((fk, idx) => (
                  <TableRow key={`${fk.id}-${idx}`}>
                    <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {fk.from}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                        <Link2 size={12} color="var(--primary)" />
                        <span>
                          {fk.table}.{fk.to}
                        </span>
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                      {fk.onDelete}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>

        {/* Indexes */}
        <Paper variant="outlined" sx={{ borderRadius: "10px", overflow: "hidden" }}>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: "1px solid var(--border)",
              bgcolor: "var(--card)",
            }}
          >
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
              Indexes ({indexes.length})
            </Typography>
          </Box>
          {indexes.length === 0 ? (
            <Box sx={{ p: 2.5, fontSize: 12.5, color: "var(--muted-foreground)" }}>
              No secondary indexes defined on this table.
            </Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>Index Name</TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>Columns</TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontWeight: 600 }}>Unique</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {indexes.map((idx) => (
                  <TableRow key={idx.name}>
                    <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {idx.name}
                    </TableCell>
                    <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                      {idx.columns.join(", ") || "—"}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {idx.unique ? (
                        <Chip label="UNIQUE" size="small" sx={{ height: 18, fontSize: 10 }} />
                      ) : (
                        "No"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      </Box>

      {/* Add Column Dialog */}
      <Dialog
        open={addColOpen}
        onClose={addColumnMutation.isPending ? undefined : () => setAddColOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          Add Column to &ldquo;{table}&rdquo;
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            size="small"
            label="Column Name"
            placeholder="e.g. status"
            value={colName}
            onChange={(e) => setColName(e.target.value)}
            autoFocus
            slotProps={{ input: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
          />
          <TextField
            select
            size="small"
            label="Data Type"
            value={colType}
            onChange={(e) => setColType(e.target.value)}
            slotProps={{ input: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
          >
            {["TEXT", "INTEGER", "REAL", "NUMERIC", "BOOLEAN", "DATETIME", "JSON", "BLOB"].map(
              (t) => (
                <MenuItem key={t} value={t} sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                  {t}
                </MenuItem>
              ),
            )}
          </TextField>
          <TextField
            size="small"
            label="Default Value (optional)"
            placeholder="e.g. 'active', 0, CURRENT_TIMESTAMP"
            value={colDefault}
            onChange={(e) => setColDefault(e.target.value)}
            slotProps={{ input: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={colNotNull}
                onChange={(e) => setColNotNull(e.target.checked)}
              />
            }
            label={<Typography sx={{ fontSize: 12.5 }}>Not Null</Typography>}
          />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => setAddColOpen(false)}
            disabled={addColumnMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            size="small"
            disabled={!colName.trim() || addColumnMutation.isPending}
            onClick={() => addColumnMutation.mutate()}
          >
            {addColumnMutation.isPending ? "Adding…" : "Add Column"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Drop Column Dialog */}
      <Dialog
        open={Boolean(dropColTarget)}
        onClose={dropColumnMutation.isPending ? undefined : () => setDropColTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
          Drop Column &ldquo;{dropColTarget}&rdquo;?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
            This will execute <Box component="code">ALTER TABLE &quot;{table}&quot; DROP COLUMN &quot;{dropColTarget}&quot;</Box> and permanently remove all data in this column.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => setDropColTarget(null)}
            disabled={dropColumnMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            color="error"
            size="small"
            disabled={dropColumnMutation.isPending}
            onClick={() => dropColTarget && dropColumnMutation.mutate(dropColTarget)}
          >
            {dropColumnMutation.isPending ? "Dropping…" : "Drop Column"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function DdlView({ table, sql }: { table: string; sql: string | null }) {
  const [copied, setCopied] = React.useState(false);
  const openQuery = useStudioStore((s) => s.openQuery);

  const formattedSql = sql ? `${sql.trim()};` : `-- No CREATE TABLE statement available for "${table}".`;

  const handleCopy = () => {
    void navigator.clipboard.writeText(formattedSql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Box sx={{ p: 2.5, overflow: "auto", flex: 1 }}>
      <Paper variant="outlined" sx={{ borderRadius: "10px", overflow: "hidden" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.25,
            borderBottom: "1px solid var(--border)",
            bgcolor: "var(--card)",
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Code2 size={15} color="var(--primary)" />
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
              CREATE TABLE Statement
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
              onClick={handleCopy}
              sx={{ height: 28, fontSize: 12 }}
            >
              {copied ? "Copied" : "Copy DDL"}
            </Button>
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<Terminal size={13} />}
              onClick={() => openQuery(formattedSql, `DDL ${table}`)}
              sx={{ height: 28, fontSize: 12 }}
            >
              Open in SQL Editor
            </Button>
          </Stack>
        </Box>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 2.5,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            lineHeight: 1.6,
            overflowX: "auto",
            bgcolor: "var(--background)",
            color: "var(--foreground)",
          }}
        >
          {formattedSql}
        </Box>
      </Paper>
    </Box>
  );
}

function LoadingSkeleton() {
  return (
    <Stack spacing={0.75} sx={{ p: 1.5 }}>
      {Array.from({ length: 10 }).map((_, index) => (
        <Skeleton key={index} variant="rounded" height={34} />
      ))}
    </Stack>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <Box
      sx={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Alert severity="error" sx={{ maxWidth: 480 }}>
        {message}
      </Alert>
    </Box>
  );
}
