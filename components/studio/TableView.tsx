"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, ListTree, RefreshCw } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { StudioTab } from "@/stores/studio-store";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { DataGrid } from "@/components/studio/DataGrid";

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
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
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
        <Database style={{ width: 16, height: 16, flexShrink: 0, color: "var(--muted-foreground)" }} />
        <Typography noWrap sx={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600 }}>
          {table}
        </Typography>

        <Stack
          direction="row"
          spacing={0.5}
          sx={{
            borderRadius: 1.5,
            border: "1px solid var(--border)",
            bgcolor: "var(--muted)",
            p: 0.25,
          }}
        >
          <Button
            type="button"
            size="small"
            variant={!isStructure ? "contained" : "text"}
            onClick={() => setView(table, "data")}
            sx={{ minHeight: 24, py: 0.25, px: 1, fontSize: 12 }}
          >
            Data
          </Button>
          <Button
            type="button"
            size="small"
            variant={isStructure ? "contained" : "text"}
            onClick={() => setView(table, "structure")}
            sx={{ minHeight: 24, py: 0.25, px: 1, fontSize: 12 }}
          >
            Structure
          </Button>
        </Stack>

        <IconButton
          size="small"
          title="Refresh"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["studio", "rows"] });
            void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
          }}
          sx={{ width: 32, height: 32 }}
        >
          <RefreshCw style={{ width: 16, height: 16 }} />
        </IconButton>
      </Box>

      {isStructure ? (
        <StructureView columns={columns} />
      ) : (
        <Box sx={{ minHeight: 0, flex: 1 }}>
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
        </Box>
      )}
    </Box>
  );
}

function StructureView({
  columns,
}: {
  columns: Array<{ name: string; type: string; notNull: boolean; pk: boolean }>;
}) {
  return (
    <Box sx={{ minHeight: 0, flex: 1, overflow: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", bgcolor: "var(--background)" }}>
              Column
            </TableCell>
            <TableCell sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", bgcolor: "var(--background)" }}>
              Type
            </TableCell>
            <TableCell sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", bgcolor: "var(--background)" }}>
              Not null
            </TableCell>
            <TableCell sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", bgcolor: "var(--background)" }}>
              Primary key
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {columns.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} align="center" sx={{ py: 3, color: "var(--muted-foreground)" }}>
                No schema information available.
              </TableCell>
            </TableRow>
          ) : (
            columns.map((column) => (
              <TableRow key={column.name}>
                <TableCell sx={{ fontWeight: 500 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <ListTree style={{ width: 14, height: 14, color: "var(--muted-foreground)" }} />
                    <span>{column.name}</span>
                  </Stack>
                </TableCell>
                <TableCell sx={{ color: "var(--muted-foreground)" }}>{column.type || "—"}</TableCell>
                <TableCell>{column.notNull ? "Yes" : "No"}</TableCell>
                <TableCell>{column.pk ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Box>
  );
}

function LoadingSkeleton() {
  return (
    <Stack spacing={0.5} sx={{ p: 1 }}>
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} variant="rounded" height={33} />
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
        p: 2,
      }}
    >
      <Typography sx={{ maxWidth: 420, textAlign: "center", fontSize: 13.5, color: "var(--destructive)" }}>
        {message}
      </Typography>
    </Box>
  );
}
