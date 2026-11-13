"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import type { StudioCellValue } from "@/lib/studio/types";
import type { StudioSortSpec } from "@/stores/studio-store";
import { formatCell, isNullCell } from "@/components/studio/format";

const ROW_HEIGHT = 33;
const HEADER_HEIGHT = 37;

interface GridRow {
  id: string;
  values: StudioCellValue[];
}

interface DataGridProps {
  columns: string[];
  rows: StudioCellValue[][];
  sort?: StudioSortSpec | null;
  onSort?: (sort: StudioSortSpec | null) => void;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
  };
  emptyText?: string;
}

export function DataGrid({
  columns,
  rows,
  sort,
  onSort,
  pagination,
  emptyText = "No rows.",
}: DataGridProps) {
  const data = React.useMemo<GridRow[]>(
    () =>
      rows.map((values, index) => ({
        id: String(index),
        values,
      })),
    [rows],
  );

  const columnDefs = React.useMemo<ColumnDef<GridRow, unknown>[]>(() => {
    return columns.map((name, index) => ({
      id: String(index),
      accessorFn: (row) => row.values[index],
      header: name,
      size: Math.max(120, Math.min(360, name.length * 12 + 200)),
      minSize: 80,
      cell: (info) => {
        const value = info.getValue() as StudioCellValue;
        return <CellValue value={value} />;
      },
    }));
  }, [columns]);

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

  const totalSize = table.getTotalSize();
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

  const startIndex = pagination
    ? pagination.total === 0
      ? 0
      : pagination.page * pagination.pageSize + 1
    : 1;
  const endIndex = pagination
    ? Math.min(pagination.total, startIndex + rows.length - 1)
    : rows.length;

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
              bgcolor: "var(--background)",
            }}
          >
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const columnName = columns[Number(header.id)];
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
                    gap: 0.5,
                    borderRight: "1px solid var(--border)",
                    px: 1,
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted-foreground)",
                    width: header.getSize(),
                    cursor: onSort ? "pointer" : "default",
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </Box>
                  {isSorted ? (
                    isSorted === "asc" ? (
                      <ArrowUp style={{ width: 12, height: 12, flexShrink: 0, color: "var(--primary)" }} />
                    ) : (
                      <ArrowDown style={{ width: 12, height: 12, flexShrink: 0, color: "var(--primary)" }} />
                    )
                  ) : onSort ? (
                    <ArrowUpDown style={{ width: 12, height: 12, flexShrink: 0, color: "var(--muted-foreground)", opacity: 0.5 }} />
                  ) : null}
                  {header.column.getCanResize() && (
                    <Box
                      data-resize-handle
                      onPointerDown={(event: React.PointerEvent) => {
                        event.stopPropagation();
                        header.getResizeHandler()(event);
                      }}
                      onDoubleClick={() => header.column.resetSize()}
                      title="Resize column"
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
          </Box>

          {/* Body */}
          {rows.length > 0 ? (
            <Box sx={{ position: "relative", height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index];
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
                      transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <Box
                        key={cell.id}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          overflow: "hidden",
                          borderRight: "1px solid var(--border)",
                          px: 1,
                          fontSize: 13,
                          width: cell.column.getSize(),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </Box>
                    ))}
                  </Box>
                );
              })}
            </Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                height: 96,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13.5,
                color: "var(--muted-foreground)",
              }}
            >
              {emptyText}
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          display: "flex",
          height: 36,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "1px solid var(--border)",
          px: 1.5,
          fontSize: 12,
          color: "var(--muted-foreground)",
        }}
      >
        {pagination ? (
          <>
            <span>
              Rows {startIndex}–{endIndex} of {pagination.total}
            </span>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
              <Button
                type="button"
                variant="text"
                size="small"
                disabled={pagination.page === 0}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                sx={{ minWidth: 0, height: 24, px: 1, fontSize: 12 }}
              >
                Prev
              </Button>
              <Box component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                Page {pagination.page + 1}
              </Box>
              <Button
                type="button"
                variant="text"
                size="small"
                disabled={endIndex >= pagination.total}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                sx={{ minWidth: 0, height: 24, px: 1, fontSize: 12 }}
              >
                Next
              </Button>
            </Stack>
          </>
        ) : (
          <span>Rows 1–{rows.length}</span>
        )}
      </Box>
    </Box>
  );
}

function CellValue({ value }: { value: StudioCellValue }) {
  const text = formatCell(value);
  const isNull = isNullCell(value);
  return (
    <Box
      component="span"
      title={text}
      sx={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        ...(isNull && { fontStyle: "italic", color: "var(--muted-foreground)" }),
      }}
    >
      {text}
    </Box>
  );
}
