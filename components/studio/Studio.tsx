"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  ArrowLeft,
  Database,
  Layers,
  Menu,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useStudioStore } from "@/stores/studio-store";
import { useStudioConnectionStore } from "@/stores/studio-connection";
import { useStudioIntentStore } from "@/stores/studio-intent";
import { Sidebar } from "@/components/studio/Sidebar";
import { TabBar } from "@/components/studio/TabBar";
import { TableView } from "@/components/studio/TableView";
import { QueryView } from "@/components/studio/QueryView";
import { SchemaView } from "@/components/studio/SchemaView";
import { ConnectScreen } from "@/components/studio/ConnectScreen";
import { CreateTableDialog } from "@/components/studio/CreateTableDialog";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";

export function Studio() {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StudioShell />
    </QueryClientProvider>
  );
}

function StudioShell() {
  const queryClient = useQueryClient();
  const isDesktop = useMediaQuery("(min-width:900px)");
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar);
  const setSidebarOpen = useStudioStore((s) => s.setSidebarOpen);
  const openTable = useStudioStore((s) => s.openTable);
  const resetStore = useStudioStore((s) => s.reset);

  const connected = useStudioConnectionStore((s) => s.connected);
  const connectionName = useStudioConnectionStore((s) => s.name);
  const disconnect = useStudioConnectionStore((s) => s.disconnect);

  const [createTableOpen, setCreateTableOpen] = React.useState(false);

  // If the user navigated here with an explicit database intent from /databases,
  // switch immediately even if a previous database was persisted.
  React.useEffect(() => {
    const intent = useStudioIntentStore.getState();
    const currentId = useStudioConnectionStore.getState().databaseId;
    if (intent.databaseId && intent.databaseId !== currentId) {
      resetStore();
      void queryClient.clear();
      useStudioConnectionStore.getState().connect(intent.databaseId, intent.name ?? "", true);
      useStudioIntentStore.getState().clearIntent();
    }
  }, [queryClient, resetStore]);

  const handleSwitchDatabase = () => {
    disconnect();
  };

  return (
    <Box
      sx={{
        display: "flex",
        height: "100dvh",
        flexDirection: "column",
        bgcolor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* Header */}
      <Box
        component="header"
        sx={{
          display: "flex",
          height: 52,
          flexShrink: 0,
          alignItems: "center",
          gap: 1.25,
          borderBottom: "1px solid var(--border)",
          bgcolor: "var(--card)",
          px: { xs: 1.25, sm: 2 },
        }}
      >
        {!isDesktop && connected && (
          <IconButton
            size="small"
            onClick={toggleSidebar}
            title="Toggle navigation sidebar"
            sx={{ width: 32, height: 32 }}
          >
            <Menu style={{ width: 17, height: 17 }} />
          </IconButton>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              width: 28,
              height: 28,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "7px",
              bgcolor: "rgba(56, 189, 248, 0.14)",
              color: "var(--primary)",
            }}
          >
            <Database style={{ width: 15, height: 15 }} />
          </Box>
          <Typography
            noWrap
            sx={{
              fontSize: { xs: 13, sm: 14 },
              fontWeight: 700,
              letterSpacing: "-0.01em",
              display: { xs: connected ? "none" : "block", sm: "block" },
            }}
          >
            SQLite Studio
          </Typography>
        </Stack>

        {connected && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={handleSwitchDatabase}
              title="Switch connected database"
              startIcon={<Plug style={{ width: 13, height: 13, color: "var(--success)", flexShrink: 0 }} />}
              sx={{
                ml: { xs: 0, sm: 0.5 },
                height: 28,
                maxWidth: { xs: 130, sm: 240 },
                px: { xs: 1, sm: 1.25 },
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                "& .MuiButton-startIcon": { mr: 0.75 },
              }}
            >
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {connectionName || "Connected"}
              </Box>
            </Button>

            <Chip
              size="small"
              icon={<ShieldCheck size={12} />}
              label="Ed25519 + TLS"
              sx={{
                display: { xs: "none", md: "inline-flex" },
                height: 22,
                fontSize: 10.5,
                color: "var(--success)",
                bgcolor: "rgba(61, 214, 140, 0.1)",
                "& .MuiChip-icon": { color: "var(--success)" },
              }}
            />
          </Stack>
        )}

        <Box sx={{ flex: 1 }} />

        {connected && (
          <Tooltip title="Refresh database metadata & tables">
            <IconButton
              size="small"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["studio"] });
              }}
              sx={{ width: 32, height: 32, border: "1px solid var(--border)", borderRadius: "8px" }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} />
            </IconButton>
          </Tooltip>
        )}

        <ThemeToggleButton sx={{ width: 32, height: 32 }} />

        <Button
          component="a"
          href="/databases"
          variant="outlined"
          size="small"
          startIcon={<ArrowLeft style={{ width: 14, height: 14 }} />}
          sx={{
            height: 30,
            minWidth: { xs: 32, sm: "auto" },
            px: { xs: 0.75, sm: 1.25 },
            fontSize: 12,
            "& .MuiButton-startIcon": { mr: { xs: 0, sm: 0.75 } },
          }}
        >
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Databases
          </Box>
        </Button>
      </Box>

      {connected ? (
        <Box sx={{ display: "flex", minHeight: 0, minWidth: 0, flex: 1, overflow: "hidden" }}>
          <Drawer
            open={!isDesktop && sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            slotProps={{
              paper: {
                sx: {
                  width: 280,
                  bgcolor: "var(--card)",
                  borderRight: "1px solid var(--border)",
                },
              },
            }}
          >
            <Sidebar
              onCreateTable={() => {
                setSidebarOpen(false);
                setCreateTableOpen(true);
              }}
              onNavigate={() => setSidebarOpen(false)}
            />
          </Drawer>

          {isDesktop ? (
            <PanelGroup direction="horizontal" style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <Panel defaultSize={20} minSize={14} maxSize={34} style={{ minWidth: 0 }}>
                <Sidebar onCreateTable={() => setCreateTableOpen(true)} />
              </Panel>
              <PanelResizeHandle
                style={{
                  width: 1,
                  backgroundColor: "var(--border)",
                  cursor: "col-resize",
                }}
              />
              <Panel style={{ minWidth: 0 }}>
                <Workspace
                  activeTabId={activeTabId}
                  onCreateTable={() => setCreateTableOpen(true)}
                />
              </Panel>
            </PanelGroup>
          ) : (
            <Box sx={{ display: "flex", minHeight: 0, minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden" }}>
              <TabBar />
              <Box sx={{ minHeight: 0, minWidth: 0, flex: 1, overflow: "hidden" }}>
                <WorkspaceContent
                  activeTabId={activeTabId}
                  onCreateTable={() => setCreateTableOpen(true)}
                />
              </Box>
            </Box>
          )}

          <CreateTableDialog
            open={createTableOpen}
            onClose={() => setCreateTableOpen(false)}
            onCreated={(createdTable) => {
              openTable(createdTable, "data");
            }}
          />
        </Box>
      ) : (
        <Box sx={{ minHeight: 0, flex: 1 }}>
          <ConnectScreen />
        </Box>
      )}
    </Box>
  );
}

function Workspace({
  activeTabId,
  onCreateTable,
}: {
  activeTabId: string | null;
  onCreateTable: () => void;
}) {
  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      <TabBar />
      <Box sx={{ minHeight: 0, flex: 1 }}>
        <WorkspaceContent activeTabId={activeTabId} onCreateTable={onCreateTable} />
      </Box>
    </Box>
  );
}

function WorkspaceContent({
  activeTabId,
  onCreateTable,
}: {
  activeTabId: string | null;
  onCreateTable: () => void;
}) {
  const activeTab = useStudioStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  if (!activeTab) return <EmptyState onCreateTable={onCreateTable} />;
  if (activeTab.kind === "table") {
    return <TableView key={activeTab.id} tab={activeTab} />;
  }
  if (activeTab.kind === "schema") {
    return <SchemaView key={activeTab.id} onCreateTable={onCreateTable} />;
  }
  return <QueryView key={activeTab.id} tab={activeTab} />;
}

function EmptyState({ onCreateTable }: { onCreateTable: () => void }) {
  const newQuery = useStudioStore((s) => s.newQuery);
  const openSchemaOverview = useStudioStore((s) => s.openSchemaOverview);

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
      <Stack spacing={3} sx={{ alignItems: "center", maxWidth: 640, width: "100%" }}>
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
            <Database size={24} />
          </Box>
          <Typography sx={{ fontSize: 18, fontWeight: 700 }}>
            Production SQLite & libSQL Studio
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: "var(--muted-foreground)", maxWidth: 460 }}>
            Browse and edit table data inline, design new tables and schemas visually, or execute raw SQL queries.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
            gap: 2,
            width: "100%",
          }}
        >
          <Paper
            variant="outlined"
            onClick={onCreateTable}
            sx={{
              p: 2,
              borderRadius: "12px",
              cursor: "pointer",
              transition: "border-color 0.15s, transform 0.15s",
              "&:hover": { borderColor: "var(--primary)", transform: "translateY(-1px)" },
            }}
          >
            <Stack spacing={1}>
              <Box sx={{ color: "var(--primary)" }}>
                <Plus size={20} />
              </Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Create Table</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Design columns, primary keys, defaults, and foreign keys visually.
              </Typography>
            </Stack>
          </Paper>

          <Paper
            variant="outlined"
            onClick={openSchemaOverview}
            sx={{
              p: 2,
              borderRadius: "12px",
              cursor: "pointer",
              transition: "border-color 0.15s, transform 0.15s",
              "&:hover": { borderColor: "var(--primary)", transform: "translateY(-1px)" },
            }}
          >
            <Stack spacing={1}>
              <Box sx={{ color: "#10b981" }}>
                <Layers size={20} />
              </Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Schema Explorer</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Inspect all tables, column types, primary keys, and row counts at a glance.
              </Typography>
            </Stack>
          </Paper>

          <Paper
            variant="outlined"
            onClick={newQuery}
            sx={{
              p: 2,
              borderRadius: "12px",
              cursor: "pointer",
              transition: "border-color 0.15s, transform 0.15s",
              "&:hover": { borderColor: "var(--primary)", transform: "translateY(-1px)" },
            }}
          >
            <Stack spacing={1}>
              <Box sx={{ color: "#f5a524" }}>
                <Terminal size={20} />
              </Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>SQL Query Editor</Typography>
              <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Run read/write SQLite statements with syntax highlighting and CSV/JSON export.
              </Typography>
            </Stack>
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}
