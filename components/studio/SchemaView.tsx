"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Database,
  KeyRound,
  Layers,
  ListTree,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Terminal,
} from "lucide-react";
import { studioApi } from "@/lib/studio-api";
import { useStudioStore } from "@/stores/studio-store";

interface SchemaViewProps {
  onCreateTable: () => void;
}

export function SchemaView({ onCreateTable }: SchemaViewProps) {
  const queryClient = useQueryClient();
  const openTable = useStudioStore((s) => s.openTable);
  const openQuery = useStudioStore((s) => s.openQuery);
  const [search, setSearch] = React.useState("");

  const tablesQuery = useQuery({
    queryKey: ["studio", "tables"],
    queryFn: () => studioApi.tables(),
    staleTime: 30_000,
  });

  const schemaQuery = useQuery({
    queryKey: ["studio", "schema"],
    queryFn: () => studioApi.schema(),
    staleTime: 30_000,
  });

  const tables = tablesQuery.data ?? [];
  const schema = schemaQuery.data ?? {};

  const filteredTables = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => {
      if (t.name.toLowerCase().includes(q)) return true;
      const cols = schema[t.name] ?? [];
      return cols.some((c) => c.name.toLowerCase().includes(q));
    });
  }, [tables, schema, search]);

  const totalColumns = React.useMemo(
    () => tables.reduce((sum, t) => sum + t.columnCount, 0),
    [tables],
  );
  const totalRows = React.useMemo(
    () => tables.reduce((sum, t) => sum + (t.rowCount ?? 0), 0),
    [tables],
  );

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      {/* Header Toolbar */}
      <Box
        sx={{
          display: "flex",
          minHeight: 46,
          flexShrink: 0,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          borderBottom: "1px solid var(--border)",
          bgcolor: "var(--card)",
          px: 2,
          py: 0.75,
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
          <Layers size={16} color="var(--primary)" />
          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
            Database Schema Explorer
          </Typography>
          <Chip
            size="small"
            label={`${tables.length} tables · ${totalColumns} cols · ${totalRows.toLocaleString()} rows`}
            sx={{
              height: 20,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              bgcolor: "var(--muted)",
            }}
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            placeholder="Filter tables or columns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={13} color="var(--muted-foreground)" />
                  </InputAdornment>
                ),
                sx: { height: 30, fontSize: 12, width: { xs: 160, sm: 220 } },
              },
            }}
          />

          <Button
            type="button"
            variant="contained"
            size="small"
            startIcon={<Plus size={14} />}
            onClick={onCreateTable}
            sx={{ height: 30, fontSize: 12 }}
          >
            Create Table
          </Button>

          <Tooltip title="Refresh schema">
            <IconButton
              size="small"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["studio", "tables"] });
                void queryClient.invalidateQueries({ queryKey: ["studio", "schema"] });
              }}
              sx={{ width: 30, height: 30, border: "1px solid var(--border)", borderRadius: "6px" }}
            >
              <RefreshCw size={14} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2.5 }}>
        {tablesQuery.isPending || schemaQuery.isPending ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)", xl: "repeat(3, 1fr)" },
              gap: 2,
            }}
          >
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="rounded" height={200} sx={{ borderRadius: "12px" }} />
            ))}
          </Box>
        ) : tables.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              minHeight: 280,
              alignItems: "center",
              justifyContent: "center",
              gap: 1.5,
              textAlign: "center",
            }}
          >
            <Database size={32} color="var(--muted-foreground)" style={{ opacity: 0.5 }} />
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                No tables in this database yet
              </Typography>
              <Typography sx={{ mt: 0.5, fontSize: 13, color: "var(--muted-foreground)", maxWidth: 380 }}>
                Create your first SQLite table using the visual table builder or run a CREATE TABLE statement in the SQL editor.
              </Typography>
            </Box>
            <Button
              type="button"
              variant="contained"
              size="small"
              startIcon={<Plus size={15} />}
              onClick={onCreateTable}
            >
              Create First Table
            </Button>
          </Box>
        ) : (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(2, 1fr)",
                xl: "repeat(3, 1fr)",
              },
              gap: 2,
              alignItems: "start",
            }}
          >
            {filteredTables.map((t) => {
              const cols = schema[t.name] ?? [];
              return (
                <Paper
                  key={t.name}
                  variant="outlined"
                  sx={{
                    borderRadius: "12px",
                    overflow: "hidden",
                    transition: "border-color 0.15s",
                    "&:hover": { borderColor: "var(--primary)" },
                  }}
                >
                  {/* Card Header */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      px: 2,
                      py: 1.25,
                      borderBottom: "1px solid var(--border)",
                      bgcolor: "var(--card)",
                    }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                      <Table2 size={15} color="var(--primary)" style={{ flexShrink: 0 }} />
                      <Typography
                        noWrap
                        sx={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 13.5,
                          fontWeight: 600,
                        }}
                      >
                        {t.name}
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                      <Chip
                        size="small"
                        label={`${(t.rowCount ?? 0).toLocaleString()} rows`}
                        sx={{
                          height: 20,
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono)",
                          bgcolor: "var(--muted)",
                        }}
                      />
                      <Tooltip title="Browse Data">
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => openTable(t.name, "data")}
                          sx={{ minWidth: 0, height: 24, px: 0.75, fontSize: 11 }}
                        >
                          Data
                        </Button>
                      </Tooltip>
                      <Tooltip title="Open in SQL Editor">
                        <IconButton
                          size="small"
                          onClick={() =>
                            openQuery(
                              `SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 50;`,
                              `Query ${t.name}`,
                            )
                          }
                          sx={{ width: 24, height: 24 }}
                        >
                          <Terminal size={12} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>

                  {/* Columns List */}
                  <Stack
                    divider={<Box sx={{ borderBottom: "1px solid var(--border)", opacity: 0.5 }} />}
                    sx={{ bgcolor: "var(--background)" }}
                  >
                    {cols.map((col) => (
                      <Box
                        key={col.name}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 1,
                          px: 2,
                          py: 0.85,
                          fontSize: 12,
                        }}
                      >
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                          {col.pk ? (
                            <Tooltip title="Primary Key">
                              <Box component="span" sx={{ display: "inline-flex", color: "#f5a524" }}>
                                <KeyRound size={12} />
                              </Box>
                            </Tooltip>
                          ) : (
                            <ListTree size={12} color="var(--muted-foreground)" />
                          )}
                          <Typography
                            noWrap
                            sx={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                              fontWeight: col.pk ? 600 : 400,
                            }}
                          >
                            {col.name}
                          </Typography>
                        </Stack>

                        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexShrink: 0 }}>
                          {col.notNull && !col.pk && (
                            <Typography
                              component="span"
                              sx={{
                                fontSize: 9.5,
                                fontFamily: "var(--font-mono)",
                                color: "var(--muted-foreground)",
                              }}
                            >
                              NOT NULL
                            </Typography>
                          )}
                          <Box
                            component="span"
                            sx={{
                              px: 0.75,
                              py: 0.15,
                              borderRadius: "4px",
                              bgcolor: "var(--muted)",
                              color: "var(--muted-foreground)",
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                            }}
                          >
                            {col.type || "ANY"}
                          </Box>
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
