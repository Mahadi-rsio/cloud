"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  KeyRound,
  Pencil,
  Trash2,
} from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { StudioCellValue, StudioColumn } from "@/lib/studio/types";
import type { StudioSortSpec } from "@/stores/studio-store";
import { formatCell, isNullCell, parseCellInput } from "@/components/studio/format";

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 40;
const SELECTION_COL_WIDTH = 42;
const ACTIONS_COL_WIDTH = 68;

interface GridRow {
  id: string;
  index: number;
  values: StudioCellValue[];
}

interface DataGridProps {
  columns: string[];
  columnTypes?: StudioColumn[];
  rows: StudioCellValue[][];
  rowIdentities?: Array<Record<string, StudioCellValue> | null>;
  canMutateRows?: boolean;
  selectedRows?: Set<number>;
  onSelectedRowsChange?: (selected: Set<number>) => void;
  onInlineCellUpdate?: (
    rowIndex: number,
    columnName: string,
    newValue: StudioCellValue,
  ) => Promise<void>;
  onEditRow?: (rowIndex: number) => void;
  onDeleteRow?: (rowIndex: number) => void;
  sort?: StudioSortSpec | null;
  onSort?: (sort: StudioSortSpec | null) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    filteredTotal?: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
  };
  emptyText?: string;
  emptyAction?: React.ReactNode;
}

export function DataGrid({
  columns,
  columnTypes,
  rows,
  rowIdentities,
  canMutateRows = false,
  selectedRows,
  onSelectedRowsChange,
  onInlineCellUpdate,
  onEditRow,
  onDeleteRow,
  sort,
  onSort,
  pagination,
  emptyText = "No rows.",
  emptyAction,
}: DataGridProps) {
  const [editingCell, setEditingCell] = React.useState<{
    rowIndex: number;
    colIndex: number;
    value: string;
    isNull: boolean;
  } | null>(null);
  const [savingCell, setSavingCell] = React.useState(false);
  const [copiedCell, setCopiedCell] = React.useState<string | null>(null);

  const colMetaMap = React.useMemo(() => {
    const map = new Map<string, StudioColumn>();
    if (columnTypes) {
      for (const c of columnTypes) {
        map.set(c.name, c);
      }
    }
    return map;
  }, [columnTypes]);

  const data = React.useMemo<GridRow[]>(
    () =>
      rows.map((values, index) => ({
        id: String(index),
        index,
        values,
      })),
    [rows],
  );

  const commitCellEdit = React.useCallback(async () => {
    if (!editingCell || !onInlineCellUpdate || savingCell) return;
    const { rowIndex, colIndex, value, isNull } = editingCell;
    const colName = columns[colIndex];
    if (!colName) {
      setEditingCell(null);
      return;
    }
    const meta = colMetaMap.get(colName);
    const parsed = parseCellInput(value, meta?.type ?? "TEXT", isNull);
    const prevValue = rows[rowIndex]?.[colIndex] ?? null;

    if (parsed === prevValue) {
      setEditingCell(null);
      return;
    }

    try {
      setSavingCell(true);
      await onInlineCellUpdate(rowIndex, colName, parsed);
      setEditingCell(null);
    } catch {
      // Leave editor open or close on error
      setEditingCell(null);
    } finally {
      setSavingCell(false);
    }
  }, [editingCell, onInlineCellUpdate, savingCell, columns, colMetaMap, rows]);

  const columnDefs = React.useMemo<ColumnDef<GridRow, unknown>[]>(() => {
    return columns.map((name, index) => {
      const meta = colMetaMap.get(name);
      return {
        id: String(index),
        accessorFn: (row) => row.values[index],
        header: name,
        size: Math.max(130, Math.min(340, name.length * 11 + 140)),
        minSize: 90,
        cell: (info) => {
          const rowIndex = info.row.original.index;
          const value = info.getValue() as StudioCellValue;
          const isEditing =
            editingCell?.rowIndex === rowIndex && editingCell?.colIndex === index;

          if (isEditing && editingCell) {
            return (
              <InlineCellEditor
                value={editingCell.value}
                isNull={editingCell.isNull}
                nullable={!meta?.notNull}
                saving={savingCell}
                onChange={(val) =>
                  setEditingCell((prev) =>
                    prev ? { ...prev, value: val, isNull: false } : null,
                  )
                }
                onToggleNull={() =>
                  setEditingCell((prev) =>
                    prev ? { ...prev, isNull: !prev.isNull } : null,
                  )
                }
                onCommit={() => void commitCellEdit()}
                onCancel={() => setEditingCell(null)}
              />
            );
          }

          const cellKey = `${rowIndex}:${index}`;
          return (
            <CellValue
              value={value}
              columnType={meta?.type}
              copied={copiedCell === cellKey}
              editable={Boolean(canMutateRows && onInlineCellUpdate && rowIdentities?.[rowIndex])}
              onDoubleClick={() => {
                if (!canMutateRows || !onInlineCellUpdate || !rowIdentities?.[rowIndex]) return;
                setEditingCell({
                  rowIndex,
                  colIndex: index,
                  value: value === null ? "" : String(value),
                  isNull: value === null,
                });
              }}
              onCopy={() => {
                const text = value === null ? "NULL" : String(value);
                void navigator.clipboard.writeText(text);
                setCopiedCell(cellKey);
                setTimeout(() => setCopiedCell((c) => (c === cellKey ? null : c)), 1400);
              }}
            />
          );
        },
      };
    });
  }, [
    columns,
    colMetaMap,
    editingCell,
    savingCell,
    copiedCell,
    canMutateRows,
    onInlineCellUpdate,
    rowIdentities,
    commitCellEdit,
  ]);

  const table = useReactTable({
    data,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
    scrollMargin: HEADER_HEIGHT,
  });

  const hasSelection = Boolean(canMutateRows && selectedRows && onSelectedRowsChange);
  const hasRowActions = Boolean(canMutateRows && (onEditRow || onDeleteRow));
  const extraWidth =
    (hasSelection ? SELECTION_COL_WIDTH : 0) + (hasRowActions ? ACTIONS_COL_WIDTH : 0);

  const totalSize = table.getTotalSize() + extraWidth;
  const headerHeight = HEADER_HEIGHT;
  const virtualRows = virtualizer.getVirtualItems();

  const handleHeaderClick = (columnName: string) => {
    if (!onSort) return;
    if (sort?.column !== columnName) {
      onSort({ column: columnName, dir: "asc" });
    } else if (sort.dir === "asc") {
      onSort({ column: columnName, dir: "desc" });
    } else {
      onSort(null);
    }
  };

  const allSelected =
    hasSelection && rows.length > 0 && selectedRows!.size === rows.length;
  const someSelected =
    hasSelection && selectedRows!.size > 0 && selectedRows!.size < rows.length;

  const toggleAll = () => {
    if (!onSelectedRowsChange) return;
    if (allSelected) {
      onSelectedRowsChange(new Set());
    } else {
      onSelectedRowsChange(new Set(rows.map((_, i) => i)));
    }
  };

  const toggleRow = (idx: number) => {
    if (!selectedRows || !onSelectedRowsChange) return;
    const next = new Set(selectedRows);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    onSelectedRowsChange(next);
  };

  const effectiveTotal = pagination
    ? pagination.filteredTotal ?? pagination.total
    : rows.length;

  const startIndex = pagination
    ? effectiveTotal === 0
      ? 0
      : pagination.page * pagination.pageSize + 1
    : rows.length === 0
      ? 0
      : 1;
  const endIndex = pagination
    ? Math.min(effectiveTotal, startIndex + rows.length - 1)
    : rows.length;
  const totalPages = pagination
    ? Math.max(1, Math.ceil(effectiveTotal / pagination.pageSize))
    : 1;

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          overscrollBehavior: "contain",
        }}
      >
        <Box sx={{ position: "relative", width: totalSize, minWidth: "100%" }}>
          {/* Header */}
          <Box
            sx={{
              position: "sticky",
              top: 0,
              zIndex: 20,
              display: "flex",
              height: headerHeight,
              borderBottom: "1px solid var(--border)",
              bgcolor: "var(--card)",
            }}
          >
            {hasSelection && (
              <Box
                sx={{
                  display: "flex",
                  width: SELECTION_COL_WIDTH,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={toggleAll}
                  disabled={rows.length === 0}
                  sx={{ p: 0.5 }}
                />
              </Box>
            )}

            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const columnName = columns[Number(header.id)];
              const meta = colMetaMap.get(columnName);
              const isSorted =
                onSort && sort?.column === columnName ? sort.dir : null;

              return (
                <Box
                  key={header.id}
                  onClick={() => handleHeaderClick(columnName)}
                  sx={{
                    position: "relative",
                    display: "flex",
                    userSelect: "none",
                    alignItems: "center",
                    gap: 0.75,
                    borderRight: "1px solid var(--border)",
                    px: 1.25,
                    fontSize: 12,
                    fontWeight: 600,
                    color: isSorted ? "var(--foreground)" : "var(--muted-foreground)",
                    width: header.getSize(),
                    cursor: onSort ? "pointer" : "default",
                    transition: "background-color 0.1s",
                    "&:hover": onSort ? { bgcolor: "var(--accent)" } : undefined,
                  }}
                >
                  {meta?.pk && (
                    <Tooltip title="Primary Key">
                      <Box component="span" sx={{ display: "inline-flex", color: "#f5a524", flexShrink: 0 }}>
                        <KeyRound size={12} />
                      </Box>
                    </Tooltip>
                  )}

                  <Box
                    component="span"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </Box>

                  {meta?.type && (
                    <Box
                      component="span"
                      sx={{
                        ml: "auto",
                        px: 0.6,
                        py: 0.1,
                        borderRadius: "4px",
                        bgcolor: "var(--muted)",
                        color: "var(--muted-foreground)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 9.5,
                        fontWeight: 500,
                        flexShrink: 0,
                        textTransform: "uppercase",
                      }}
                    >
                      {meta.type}
                    </Box>
                  )}

                  {isSorted ? (
                    isSorted === "asc" ? (
                      <ArrowUp style={{ width: 12, height: 12, flexShrink: 0, color: "var(--primary)" }} />
                    ) : (
                      <ArrowDown style={{ width: 12, height: 12, flexShrink: 0, color: "var(--primary)" }} />
                    )
                  ) : onSort ? (
                    <ArrowUpDown
                      style={{
                        width: 11,
                        height: 11,
                        flexShrink: 0,
                        color: "var(--muted-foreground)",
                        opacity: 0.4,
                      }}
                    />
                  ) : null}

                  {header.column.getCanResize() && (
                    <Box
                      data-resize-handle
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(event: React.PointerEvent) => {
                        event.stopPropagation();
                        header.getResizeHandler()(event);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        header.column.resetSize();
                      }}
                      title="Drag to resize column"
                      sx={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        zIndex: 10,
                        height: "100%",
                        width: 4,
                        cursor: "col-resize",
                        touchAction: "none",
                        bgcolor: "transparent",
                        "&:hover": { bgcolor: "var(--primary)" },
                      }}
                    />
                  )}
                </Box>
              );
            })}

            {hasRowActions && (
              <Box
                sx={{
                  display: "flex",
                  width: ACTIONS_COL_WIDTH,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  px: 1,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--muted-foreground)",
                }}
              >
                Actions
              </Box>
            )}
          </Box>

          {/* Body */}
          {rows.length > 0 ? (
            <Box sx={{ position: "relative", height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index];
                const isSelected = hasSelection && selectedRows!.has(virtualRow.index);

                return (
                  <Box
                    key={virtualRow.key}
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      display: "flex",
                      borderBottom: "1px solid var(--border)",
                      height: ROW_HEIGHT,
                      width: totalSize,
                      bgcolor: isSelected
                        ? "rgba(56, 189, 248, 0.08)"
                        : virtualRow.index % 2 === 1
                          ? "rgba(255, 255, 255, 0.01)"
                          : "transparent",
                      transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                      "&:hover": {
                        bgcolor: isSelected
                          ? "rgba(56, 189, 248, 0.12)"
                          : "var(--accent)",
                      },
                      "&:hover .row-action-btns": {
                        opacity: 1,
                      },
                    }}
                  >
                    {hasSelection && (
                      <Box
                        sx={{
                          display: "flex",
                          width: SELECTION_COL_WIDTH,
                          flexShrink: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRight: "1px solid var(--border)",
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => toggleRow(virtualRow.index)}
                          sx={{ p: 0.5 }}
                        />
                      </Box>
                    )}

                    {row.getVisibleCells().map((cell) => (
                      <Box
                        key={cell.id}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          overflow: "hidden",
                          borderRight: "1px solid var(--border)",
                          px: 1.25,
                          fontSize: 12.5,
                          width: cell.column.getSize(),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Box>
                    ))}

                    {hasRowActions && (
                      <Box
                        className="row-action-btns"
                        sx={{
                          display: "flex",
                          width: ACTIONS_COL_WIDTH,
                          flexShrink: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 0.25,
                          opacity: { xs: 1, md: 0.35 },
                          transition: "opacity 0.15s",
                        }}
                      >
                        {onEditRow && (
                          <Tooltip title="Edit row">
                            <IconButton
                              size="small"
                              onClick={() => onEditRow(virtualRow.index)}
                              sx={{ width: 26, height: 26, color: "var(--muted-foreground)", "&:hover": { color: "var(--foreground)" } }}
                            >
                              <Pencil size={13} />
                            </IconButton>
                          </Tooltip>
                        )}
                        {onDeleteRow && (
                          <Tooltip title="Delete row">
                            <IconButton
                              size="small"
                              onClick={() => onDeleteRow(virtualRow.index)}
                              sx={{ width: 26, height: 26, color: "var(--muted-foreground)", "&:hover": { color: "var(--destructive)" } }}
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                height: 180,
                alignItems: "center",
                justifyContent: "center",
                gap: 1.5,
                p: 3,
                fontSize: 13.5,
                color: "var(--muted-foreground)",
              }}
            >
              <span>{emptyText}</span>
              {emptyAction}
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          display: "flex",
          minHeight: 40,
          flexShrink: 0,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          borderTop: "1px solid var(--border)",
          bgcolor: "var(--card)",
          px: 1.5,
          py: 0.5,
          fontSize: 12,
          color: "var(--muted-foreground)",
        }}
      >
        {pagination ? (
          <>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>
                Showing{" "}
                <Box component="span" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                  {startIndex}–{endIndex}
                </Box>{" "}
                of{" "}
                <Box component="span" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                  {effectiveTotal.toLocaleString()}
                </Box>
                {pagination.filteredTotal !== undefined &&
                  pagination.filteredTotal !== pagination.total && (
                    <span> (filtered from {pagination.total.toLocaleString()})</span>
                  )}
              </Typography>

              {canMutateRows && onInlineCellUpdate && (
                <Typography
                  sx={{
                    display: { xs: "none", lg: "inline" },
                    fontSize: 11,
                    color: "var(--muted-foreground)",
                    opacity: 0.75,
                  }}
                >
                  · Double-click any cell to edit inline
                </Typography>
              )}
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              {pagination.onPageSizeChange && (
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", display: { xs: "none", sm: "flex" } }}>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                    Rows per page:
                  </Typography>
                  <Select
                    size="small"
                    value={pagination.pageSize}
                    onChange={(e) => pagination.onPageSizeChange!(Number(e.target.value))}
                    sx={{
                      height: 26,
                      fontSize: 12,
                      "& .MuiSelect-select": { py: 0.25, px: 1 },
                    }}
                  >
                    {[25, 50, 100, 250].map((sz) => (
                      <MenuItem key={sz} value={sz} sx={{ fontSize: 12 }}>
                        {sz}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
              )}

              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={pagination.page === 0}
                  onClick={() => pagination.onPageChange(pagination.page - 1)}
                  startIcon={<ChevronLeft size={14} />}
                  sx={{ minWidth: 0, height: 26, px: 1, fontSize: 11.5 }}
                >
                  Prev
                </Button>
                <Box
                  component="span"
                  sx={{
                    px: 1,
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--foreground)",
                  }}
                >
                  {pagination.page + 1} / {totalPages}
                </Box>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  disabled={endIndex >= effectiveTotal}
                  onClick={() => pagination.onPageChange(pagination.page + 1)}
                  endIcon={<ChevronRight size={14} />}
                  sx={{ minWidth: 0, height: 26, px: 1, fontSize: 11.5 }}
                >
                  Next
                </Button>
              </Stack>
            </Stack>
          </>
        ) : (
          <Typography sx={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {rows.length} {rows.length === 1 ? "row" : "rows"} returned
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function InlineCellEditor({
  value,
  isNull,
  nullable,
  saving,
  onChange,
  onToggleNull,
  onCommit,
  onCancel,
}: {
  value: string;
  isNull: boolean;
  nullable: boolean;
  saving: boolean;
  onChange: (val: string) => void;
  onToggleNull: () => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        gap: 0.5,
      }}
    >
      <Box
        component="input"
        ref={inputRef}
        type="text"
        disabled={saving || isNull}
        value={isNull ? "NULL" : value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit()}
        sx={{
          flex: 1,
          minWidth: 0,
          height: 26,
          px: 0.75,
          borderRadius: "4px",
          border: "1.5px solid var(--primary)",
          bgcolor: "var(--background)",
          color: isNull ? "var(--muted-foreground)" : "var(--foreground)",
          fontStyle: isNull ? "italic" : "normal",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          outline: "none",
        }}
      />
      {nullable && (
        <Button
          type="button"
          size="small"
          variant={isNull ? "contained" : "outlined"}
          onMouseDown={(e) => {
            e.preventDefault();
            onToggleNull();
          }}
          sx={{
            minWidth: 0,
            height: 22,
            px: 0.6,
            fontSize: 9.5,
            fontFamily: "var(--font-mono)",
          }}
        >
          NULL
        </Button>
      )}
    </Box>
  );
}

function CellValue({
  value,
  columnType,
  copied,
  editable,
  onDoubleClick,
  onCopy,
}: {
  value: StudioCellValue;
  columnType?: string;
  copied: boolean;
  editable: boolean;
  onDoubleClick: () => void;
  onCopy: () => void;
}) {
  const text = formatCell(value);
  const isNull = isNullCell(value);
  const upperType = (columnType ?? "").toUpperCase();
  const isNumeric =
    typeof value === "number" ||
    upperType.includes("INT") ||
    upperType.includes("REAL") ||
    upperType.includes("NUMERIC");

  return (
    <Box
      onDoubleClick={onDoubleClick}
      title={editable ? `${text} (Double-click to edit)` : text}
      sx={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 0.5,
        cursor: editable ? "text" : "default",
        "&:hover .cell-copy-btn": {
          opacity: 1,
        },
      }}
    >
      <Box
        component="span"
        sx={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)",
          fontSize: isNull ? 11 : 12.5,
          ...(isNull
            ? {
                px: 0.6,
                py: 0.1,
                borderRadius: "4px",
                bgcolor: "var(--muted)",
                fontStyle: "italic",
                color: "var(--muted-foreground)",
              }
            : isNumeric
              ? { color: "var(--primary)" }
              : {}),
        }}
      >
        {text}
      </Box>

      <IconButton
        className="cell-copy-btn"
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        title="Copy cell value"
        sx={{
          opacity: copied ? 1 : 0,
          p: 0.25,
          width: 20,
          height: 20,
          flexShrink: 0,
          color: copied ? "var(--success)" : "var(--muted-foreground)",
          transition: "opacity 0.1s",
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </IconButton>
    </Box>
  );
}
