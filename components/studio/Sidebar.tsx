"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Table2 } from "lucide-react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { studioApi } from "@/lib/studio-api";
import { useStudioStore } from "@/stores/studio-store";

export function Sidebar() {
  const openTable = useStudioStore((s) => s.openTable);
  const newQuery = useStudioStore((s) => s.newQuery);
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const [filter, setFilter] = React.useState("");

  const activeTable = tabs.find((tab) => tab.id === activeTabId)?.table;

  const { data: tables, isPending } = useQuery({
    queryKey: ["studio", "tables"],
    queryFn: () => studioApi.tables(),
    staleTime: 60_000,
  });

  const filtered = React.useMemo(() => {
    if (!tables) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, filter]);

  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", p: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search tables"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search style={{ width: 14, height: 14, color: "var(--muted-foreground)" }} />
                </InputAdornment>
              ),
              sx: { height: 32, fontSize: 12 },
            },
          }}
        />
        <IconButton
          size="small"
          onClick={newQuery}
          title="New query"
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            border: "1px solid var(--border)",
            borderRadius: 1.5,
          }}
        >
          <Plus style={{ width: 16, height: 16 }} />
        </IconButton>
      </Stack>

      <Box sx={{ minHeight: 0, flex: 1, overflowY: "auto", px: 0.75, pb: 1 }}>
        {isPending ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={16} sx={{ color: "var(--muted-foreground)" }} />
          </Box>
        ) : filtered.length === 0 ? (
          <Typography sx={{ px: 1, py: 1.5, fontSize: 12, color: "var(--muted-foreground)" }}>
            {tables && tables.length === 0
              ? "No tables in this database."
              : "No tables match your search."}
          </Typography>
        ) : (
          <Stack component="ul" spacing={0.25} sx={{ m: 0, p: 0, listStyle: "none" }}>
            {filtered.map((table) => {
              const active = activeTable === table.name;
              return (
                <li key={table.name}>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => openTable(table.name)}
                    title={`${table.name} · ${table.columnCount} columns`}
                    sx={{
                      display: "flex",
                      width: "100%",
                      alignItems: "center",
                      gap: 1,
                      borderRadius: 1.5,
                      border: 0,
                      px: 1,
                      py: 0.75,
                      textAlign: "left",
                      fontSize: 13.5,
                      cursor: "pointer",
                      bgcolor: active ? "var(--accent)" : "transparent",
                      color: active ? "var(--accent-foreground)" : "var(--foreground)",
                      "&:hover": {
                        bgcolor: active ? "var(--accent)" : "rgba(255,255,255,0.05)",
                      },
                    }}
                  >
                    <Table2 style={{ width: 14, height: 14, flexShrink: 0, color: "var(--muted-foreground)" }} />
                    <Box
                      component="span"
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {table.name}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        flexShrink: 0,
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {table.columnCount}
                    </Box>
                  </Box>
                </li>
              );
            })}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
