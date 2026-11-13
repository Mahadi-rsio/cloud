"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Database, PlugZap } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useStudioConnectionStore } from "@/stores/studio-connection";
import { useStudioIntentStore } from "@/stores/studio-intent";
import { useStudioStore } from "@/stores/studio-store";
import { studioApi } from "@/lib/studio-api";
import { listDatabases, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";

export function ConnectScreen() {
  const queryClient = useQueryClient();
  const persistedName = useStudioConnectionStore((s) => s.name);
  const resetStore = useStudioStore((s) => s.reset);

  const [databases, setDatabases] = React.useState<DatabaseItem[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);

  const loadDatabases = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listDatabases();
      setDatabases(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const autoConnected = React.useRef(false);
  React.useEffect(() => {
    if (autoConnected.current) return;
    const intent = useStudioIntentStore.getState();
    if (!intent.databaseId) {
      if (persistedName) setSelectedId(useStudioConnectionStore.getState().databaseId);
      return;
    }
    autoConnected.current = true;
    const targetId = intent.databaseId;
    const targetName = intent.name ?? "";
    useStudioIntentStore.getState().clearIntent();
    setSelectedId(targetId);
    void connectCore(targetId, targetName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectCore = async (databaseId: string, name: string) => {
    setError(null);
    setTesting(true);
    const previousId = useStudioConnectionStore.getState().databaseId;
    if (previousId && previousId !== databaseId) {
      resetStore();
      void queryClient.clear();
    }
    useStudioConnectionStore.getState().connect(databaseId, name, false);
    try {
      await studioApi.tables();
      useStudioConnectionStore.getState().setConnected(true);
    } catch (err) {
      setError(extractErrorMessage(err));
      setTesting(false);
    }
  };

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const db = databases.find((d) => d.id === selectedId);
    setTesting(true);
    await connectCore(selectedId, db?.name ?? selectedId);
  };

  return (
    <Box
      sx={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        overflowY: "auto",
        p: 3,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 440 }}>
        <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
          <Box
            sx={{
              display: "flex",
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "12px",
              bgcolor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <Database style={{ width: 22, height: 22 }} />
          </Box>
          <Typography component="h1" variant="h6" sx={{ fontSize: 19, fontWeight: 700 }}>
            Connect to a Database
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "var(--muted-foreground)" }}>
            Select one of your serverless SQLite databases to browse tables, inspect schemas, and edit records.
          </Typography>
        </Stack>

        <Stack component="form" onSubmit={handleConnect} spacing={2} sx={{ mt: 3 }}>
          <Stack spacing={1}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}>
              Available Databases
            </Typography>
            {loading ? (
              <Box
                sx={{
                  display: "flex",
                  height: 112,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 2,
                  border: "1px solid var(--border)",
                  bgcolor: "var(--card)",
                }}
              >
                <CircularProgress size={20} sx={{ color: "var(--muted-foreground)" }} />
              </Box>
            ) : error && !testing ? (
              <Stack
                spacing={1}
                sx={{
                  alignItems: "center",
                  borderRadius: 2,
                  border: "1px solid rgba(239,68,68,0.3)",
                  bgcolor: "rgba(239,68,68,0.06)",
                  p: 2,
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "var(--destructive)",
                }}
              >
                <span>{error}</span>
                <Button type="button" variant="outlined" size="small" onClick={() => void loadDatabases()}>
                  Retry
                </Button>
              </Stack>
            ) : databases.length === 0 ? (
              <Box
                sx={{
                  borderRadius: 2,
                  border: "1px solid var(--border)",
                  bgcolor: "var(--card)",
                  p: 2.5,
                  textAlign: "center",
                  fontSize: 12.5,
                  color: "var(--muted-foreground)",
                }}
              >
                You don&apos;t have any databases yet. Create one from the Databases page.
              </Box>
            ) : (
              <Stack spacing={0.75} sx={{ maxHeight: 280, overflowY: "auto", pr: 0.5 }}>
                {databases.map((db) => {
                  const selected = selectedId === db.id;
                  return (
                    <Box
                      key={db.id}
                      component="button"
                      type="button"
                      onClick={() => setSelectedId(db.id)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        borderRadius: "10px",
                        border: selected ? "1.5px solid var(--primary)" : "1px solid var(--border)",
                        bgcolor: selected ? "rgba(56, 189, 248, 0.1)" : "var(--card)",
                        px: 1.5,
                        py: 1.25,
                        textAlign: "left",
                        cursor: "pointer",
                        color: "inherit",
                        transition: "all 0.12s",
                        "&:hover": {
                          bgcolor: selected ? "rgba(56, 189, 248, 0.14)" : "var(--accent)",
                        },
                      }}
                    >
                      <Database style={{ width: 16, height: 16, flexShrink: 0, color: "var(--primary)" }} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 600 }}>
                          {db.name}
                        </Typography>
                        <Typography
                          noWrap
                          sx={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            color: "var(--muted-foreground)",
                          }}
                        >
                          {db.namespace} · {db.region.toUpperCase()}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Stack>

          {error && testing && (
            <Box
              sx={{
                borderRadius: 1.5,
                border: "1px solid rgba(239,68,68,0.3)",
                bgcolor: "rgba(239,68,68,0.06)",
                px: 1.5,
                py: 1,
                fontSize: 12,
                color: "var(--destructive)",
              }}
            >
              {error}
            </Box>
          )}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={!selectedId || loading || testing}
            startIcon={
              testing ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <PlugZap style={{ width: 16, height: 16 }} />
              )
            }
          >
            {testing ? "Connecting…" : "Open Studio"}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
