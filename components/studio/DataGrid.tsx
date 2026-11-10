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
import { cn } from "cn";
import type { StudioCellValue } from "@/lib/studio/types";
import type { StudioSortSpec } from "@/stores/studio-store";
import { formatCell, isNullCell } from "@/components/studio/format";
import { Button } from "@/components/ui/button";

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
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto overscroll-contain min-h-0"
      >
        <div className="relative" style={{ width: totalSize, minWidth: "100%" }}>
          {/* Header */}
          <div
            className="sticky top-0 z-20 flex border-b bg-background/95 backdrop-blur"
            style={{ height: headerHeight }}
          >
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const columnName = columns[Number(header.id)];
              const isSorted =
                onSort && sort?.column === columnName
                  ? sort.dir
                  : null;
              return (
                <div
                  key={header.id}
                  className="relative flex select-none items-center gap-1 border-r border-border/60 px-2 text-xs font-semibold text-muted-foreground"
                  style={{ width: header.getSize() }}
                  onClick={() => handleHeaderClick(columnName)}
                >
                  <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                  {isSorted ? (
                    isSorted === "asc" ? (
                      <ArrowUp className="size-3 shrink-0 text-primary" />
                    ) : (
                      <ArrowDown className="size-3 shrink-0 text-primary" />
                    )
                  ) : onSort ? (
                    <ArrowUpDown className="size-3 shrink-0 text-muted-foreground/50" />
                  ) : null}
                  {header.column.getCanResize() && (
                    <div
                      data-resize-handle
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        header.getResizeHandler()(event);
                      }}
                      onDoubleClick={() => header.column.resetSize()}
                      className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-primary/60"
                      title="Resize column"
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Body */}
          {rows.length > 0 ? (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => {
                const row = table.getRowModel().rows[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    className="absolute top-0 left-0 flex border-b border-border/50"
                    style={{
                      height: ROW_HEIGHT,
                      width: totalSize,
                      transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        className="flex items-center overflow-hidden border-r border-border/40 px-2 text-[13px]"
                        style={{ width: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex h-9 shrink-0 items-center justify-between border-t px-3 text-xs text-muted-foreground">
        {pagination ? (
          <>
            <span>
              Rows {startIndex}–{endIndex} of {pagination.total}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                disabled={pagination.page === 0}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
              >
                Prev
              </Button>
              <span className="tabular-nums">Page {pagination.page + 1}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                disabled={endIndex >= pagination.total}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        ) : (
          <span>Rows 1–{rows.length}</span>
        )}
      </div>
    </div>
  );
}

function CellValue({ value }: { value: StudioCellValue }) {
  const text = formatCell(value);
  const isNull = isNullCell(value);
  return (
    <span
      className={cn("truncate", isNull && "italic text-muted-foreground")}
      title={text}
    >
      {text}
    </span>
  );
}