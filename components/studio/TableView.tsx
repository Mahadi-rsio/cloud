"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ListTree, RefreshCw } from "lucide-react";
import { cn } from "cn";
import type { StudioTab } from "@/stores/studio-store";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { DataGrid } from "@/components/studio/DataGrid";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 50;

export function TableView({ tab }: { tab: StudioTab }) {
  const table = tab.table!;
  const queryClient = useQueryClient();

  const tableState = useStudioStore((s) => s.tableStates[table]) ?? {
    page: 0,
    sort: null,
    view: "data" as const,
  };
  const setPage = useStudioStore((s) => s.setPage);
  const setSort = useStudioStore((s) => s.setSort);
  const setView = useStudioStore((s) => s.setView);

  const rowsQuery = useQuery({
    queryKey: ["studio", "rows", table, tableState.page, tableState.sort],
    queryFn: () =>
      studioApi.rows({
        table,
        page: tableState.page,
        pageSize: PAGE_SIZE,
        sortColumn: tableState.sort?.column,
        sortDir: tableState.sort?.dir,
      }),
    placeholderData: (previous) => previous,
  });

  const schemaQuery = useQuery({
    queryKey: ["studio", "schema"],
    queryFn: () => studioApi.schema(),
    staleTime: 60_000,
  });

  const columns = schemaQuery.data?.[table] ?? [];
  const isStructure = tableState.view === "structure";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Database className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{table}</span>

        <div className="flex items-center rounded-md border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setView(table, "data")}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              !isStructure ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Data
          </button>
          <button
            type="button"
            onClick={() => setView(table, "structure")}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              isStructure ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            Structure
          </button>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          title="Refresh"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["studio", "rows"] });
            void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
          }}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {isStructure ? (
        <StructureView columns={columns} />
      ) : (
        <div className="min-h-0 flex-1">
          {rowsQuery.isPending && !rowsQuery.data ? (
            <LoadingSkeleton />
          ) : rowsQuery.isError ? (
            <ErrorState message={rowsQuery.error.message} />
          ) : (
            <DataGrid
              columns={rowsQuery.data!.columns}
              rows={rowsQuery.data!.rows}
              sort={tableState.sort}
              onSort={(sort) => {
                setSort(table, sort);
                setPage(table, 0);
              }}
              pagination={{
                page: tableState.page,
                pageSize: PAGE_SIZE,
                total: rowsQuery.data!.total,
                onPageChange: (page) => setPage(table, page),
              }}
              emptyText={`Table "${table}" is empty.`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StructureView({ columns }: { columns: Array<{ name: string; type: string; notNull: boolean; pk: boolean }> }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Column</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Not null</th>
            <th className="px-3 py-2 font-semibold">Primary key</th>
          </tr>
        </thead>
        <tbody>
          {columns.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                No schema information available.
              </td>
            </tr>
          ) : (
            columns.map((column) => (
              <tr key={column.name} className="border-b border-border/50">
                <td className="flex items-center gap-2 px-3 py-1.5 font-medium">
                  <ListTree className="size-3.5 text-muted-foreground" />
                  {column.name}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{column.type || "—"}</td>
                <td className="px-3 py-1.5">{column.notNull ? "Yes" : "No"}</td>
                <td className="px-3 py-1.5">{column.pk ? "Yes" : "No"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-[33px] animate-pulse rounded bg-muted/40" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <p className="max-w-md text-center text-sm text-destructive">{message}</p>
    </div>
  );
}