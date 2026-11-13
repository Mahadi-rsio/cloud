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
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
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
          position: "sticky",
          top: 0,
          zIndex: 30,
          display: "flex",
          minHeight: 56,
          flexShrink: 0,
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid var(--border)",
          bgcolor: "color-mix(in oklab, var(--card) 92%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          px: { xs: 1.5, sm: 2 },
          py: 0.75,
        }}
      >
        {!isDesktop && connected && (
          <Tooltip title="Toggle navigation sidebar" arrow>
            <IconButton
              aria-label="Toggle navigation sidebar"
              onClick={toggleSidebar}
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                border: "1px solid var(--border)",
                borderRadius: "10px",
                color: "var(--foreground)",
              }}
            >
              <Menu size={18} />
            </IconButton>
          </Tooltip>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              width: 44,
              height: 44,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "10px",
              bgcolor: "color-mix(in oklab, var(--primary) 14%, transparent)",
              color: "var(--primary)",
            }}
          >
            <Database size={18} />
          </Box>
          <Typography
            noWrap
            sx={{
              fontSize: { xs: 14, sm: 15 },
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
            <Tooltip title="Switch connected database" arrow>
              <Button
                type="button"
                variant="outlined"
                onClick={handleSwitchDatabase}
                startIcon={<Plug size={15} style={{ color: "var(--success)", flexShrink: 0 }} />}
                sx={{
                  height: 44,
                  minHeight: 44,
                  maxWidth: { xs: 118, sm: 220 },
                  px: 1.5,
                  borderRadius: "10px",
                  fontSize: 13,
                  fontFamily: "var(--font-mono)",
                  "& .MuiButton-startIcon": { mr: 0.75 },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {connectionName || "Connected"}
                </Box>
              </Button>
            </Tooltip>

            <Chip
              size="small"
              icon={<ShieldCheck size={12} />}
              label="Ed25519 + TLS"
              sx={{
                display: { xs: "none", md: "inline-flex" },
                height: 24,
                fontSize: 11,
                color: "var(--success)",
                bgcolor: "rgba(61, 214, 140, 0.1)",
                "& .MuiChip-icon": { color: "var(--success)" },
              }}
            />
          </Stack>
        )}

        <Box sx={{ flex: 1, minWidth: 4 }} />

        {connected && (
          <Tooltip title="Refresh database metadata & tables" arrow>
            <IconButton
              aria-label="Refresh database metadata & tables"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["studio"] });
              }}
              sx={{
                width: 44,
                height: 44,
                flexShrink: 0,
                border: "1px solid var(--border)",
                borderRadius: "10px",
                color: "var(--foreground)",
              }}
            >
              <RefreshCw size={18} />
            </IconButton>
          </Tooltip>
        )}

        <ThemeToggleButton
          sx={{
            width: 44,
            height: 44,
            border: "1px solid var(--border)",
            borderRadius: "10px",
          }}
        />

        <Tooltip title="Back to databases" arrow>
          <IconButton
            component="a"
            href="/databases"
            aria-label="Back to databases"
            sx={{
              width: 44,
              height: 44,
              flexShrink: 0,
              border: "1px solid var(--border)",
              borderRadius: "10px",
              color: "var(--foreground)",
              "&:hover": { bgcolor: "var(--accent)", borderColor: "var(--primary)" },
            }}
          >
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
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

  const tiles = [
    {
      title: "Create Table",
      description: "Design columns, primary keys, defaults, and foreign keys visually.",
      icon: <Plus size={20} />,
      iconColor: "var(--primary)",
      iconBg: "color-mix(in oklab, var(--primary) 14%, transparent)",
      onClick: onCreateTable,
    },
    {
      title: "Schema Explorer",
      description: "Inspect all tables, column types, primary keys, and row counts at a glance.",
      icon: <Layers size={20} />,
      iconColor: "var(--success)",
      iconBg: "color-mix(in oklab, var(--success) 14%, transparent)",
      onClick: openSchemaOverview,
    },
    {
      title: "SQL Query Editor",
      description: "Run read/write SQLite statements with syntax highlighting and CSV/JSON export.",
      icon: <Terminal size={20} />,
      iconColor: "var(--warning)",
      iconBg: "color-mix(in oklab, var(--warning) 14%, transparent)",
      onClick: newQuery,
    },
  ];

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        px: { xs: 2, sm: 3 },
        pt: { xs: 3, sm: 4 },
        pb: 4,
      }}
    >
      <Stack
        spacing={3}
        sx={{
          alignItems: "center",
          maxWidth: 680,
          width: "100%",
          mx: "auto",
          my: "auto",
        }}
      >
        <Stack spacing={1.25} sx={{ alignItems: "center", textAlign: "center" }}>
          <Box
            sx={{
              display: "flex",
              width: 52,
              height: 52,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "14px",
              bgcolor: "color-mix(in oklab, var(--primary) 14%, transparent)",
              color: "var(--primary)",
            }}
          >
            <Database size={24} />
          </Box>
          <Typography sx={{ fontSize: { xs: 18, sm: 20 }, fontWeight: 700, lineHeight: 1.3 }}>
            Production SQLite & libSQL Studio
          </Typography>
          <Typography sx={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 460, lineHeight: 1.5 }}>
            Browse and edit table data inline, design new tables and schemas visually, or execute raw SQL queries.
          </Typography>
        </Stack>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
            gap: 2,
            width: "100%",
            alignItems: "stretch",
          }}
        >
          {tiles.map((tile) => (
            <ButtonBase
              key={tile.title}
              type="button"
              onClick={tile.onClick}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                justifyContent: "flex-start",
                textAlign: "left",
                height: "100%",
                p: 2.5,
                borderRadius: "16px",
                border: "1px solid var(--border)",
                bgcolor: "var(--card)",
                transition: "border-color 150ms ease, transform 150ms ease, background-color 150ms ease",
                "&:hover": {
                  borderColor: "var(--primary)",
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  borderColor: "var(--primary)",
                  transform: "translateY(0)",
                },
                "&:focus-visible": {
                  outline: "2px solid var(--ring)",
                  outlineOffset: 2,
                  borderColor: "var(--primary)",
                },
              }}
            >
              <Stack spacing={1.25} sx={{ width: "100%" }}>
                <Box
                  sx={{
                    display: "flex",
                    width: 40,
                    height: 40,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "10px",
                    bgcolor: tile.iconBg,
                    color: tile.iconColor,
                  }}
                >
                  {tile.icon}
                </Box>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                  {tile.title}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
                  {tile.description}
                </Typography>
              </Stack>
            </ButtonBase>
          ))}
        </Box>
      </Stack>
    </Box>
  );
}
