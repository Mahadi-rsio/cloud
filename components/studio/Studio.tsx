"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ArrowLeft, Menu, Plug, RefreshCw, Terminal } from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useStudioStore } from "@/stores/studio-store";
import { useStudioConnectionStore } from "@/stores/studio-connection";
import { Sidebar } from "@/components/studio/Sidebar";
import { TabBar } from "@/components/studio/TabBar";
import { TableView } from "@/components/studio/TableView";
import { QueryView } from "@/components/studio/QueryView";
import { ConnectScreen } from "@/components/studio/ConnectScreen";

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
  const isDesktop = useMediaQuery("(min-width:600px)");
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar);

  const connected = useStudioConnectionStore((s) => s.connected);
  const connectionName = useStudioConnectionStore((s) => s.name);
  const disconnect = useStudioConnectionStore((s) => s.disconnect);

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
          height: 48,
          flexShrink: 0,
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid var(--border)",
          px: 1.5,
        }}
      >
        {!isDesktop && (
          <IconButton
            size="small"
            onClick={toggleSidebar}
            title="Toggle sidebar"
            sx={{ width: 32, height: 32 }}
          >
            <Menu style={{ width: 16, height: 16 }} />
          </IconButton>
        )}

        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Terminal style={{ width: 16, height: 16, color: "var(--primary)" }} />
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Lite Studio</Typography>
        </Stack>

        {connected && (
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={disconnect}
            title="Change connection"
            startIcon={<Plug style={{ width: 14, height: 14, color: "#10b981", flexShrink: 0 }} />}
            sx={{
              ml: 0.5,
              height: 28,
              maxWidth: 220,
              px: 1,
              fontSize: 12,
              "& .MuiButton-startIcon": { mr: 0.75 },
            }}
          >
            <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {connectionName || "Connected"}
            </Box>
          </Button>
        )}

        <Box sx={{ flex: 1 }} />

        {connected && (
          <IconButton
            size="small"
            title="Refresh database metadata"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["studio"] });
            }}
            sx={{ width: 32, height: 32 }}
          >
            <RefreshCw style={{ width: 16, height: 16 }} />
          </IconButton>
        )}

        <Button
          component="a"
          href="/databases"
          variant="text"
          size="small"
          startIcon={<ArrowLeft style={{ width: 14, height: 14 }} />}
          sx={{ height: 32, px: 1, fontSize: 12.5, color: "var(--foreground)" }}
        >
          Dashboard
        </Button>
      </Box>

      {connected ? (
        <Box sx={{ display: "flex", minHeight: 0, flex: 1 }}>
          <Drawer
            open={!isDesktop && sidebarOpen}
            onClose={toggleSidebar}
            slotProps={{
              paper: {
                sx: { width: 288, bgcolor: "var(--background)", borderRight: "1px solid var(--border)" },
              },
            }}
          >
            <Sidebar />
          </Drawer>

          {isDesktop ? (
            <PanelGroup direction="horizontal" style={{ flex: 1, minHeight: 0, display: "flex" }}>
              <Panel defaultSize={18} minSize={12} maxSize={35} style={{ minWidth: 0 }}>
                <Sidebar />
              </Panel>
              <PanelResizeHandle
                style={{
                  width: 1,
                  backgroundColor: "var(--border)",
                  cursor: "col-resize",
                }}
              />
              <Panel style={{ minWidth: 0 }}>
                <Workspace activeTabId={activeTabId} />
              </Panel>
            </PanelGroup>
          ) : (
            <Box sx={{ display: "flex", minHeight: 0, flex: 1, flexDirection: "column" }}>
              <TabBar />
              <Box sx={{ minHeight: 0, flex: 1 }}>
                <WorkspaceContent activeTabId={activeTabId} />
              </Box>
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ minHeight: 0, flex: 1 }}>
          <ConnectScreen />
        </Box>
      )}
    </Box>
  );
}

function Workspace({ activeTabId }: { activeTabId: string | null }) {
  return (
    <Box sx={{ display: "flex", height: "100%", minHeight: 0, flexDirection: "column" }}>
      <TabBar />
      <Box sx={{ minHeight: 0, flex: 1 }}>
        <WorkspaceContent activeTabId={activeTabId} />
      </Box>
    </Box>
  );
}

function WorkspaceContent({ activeTabId }: { activeTabId: string | null }) {
  const activeTab = useStudioStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  if (!activeTab) return <EmptyState />;
  return activeTab.kind === "table" ? (
    <TableView key={activeTab.id} tab={activeTab} />
  ) : (
    <QueryView key={activeTab.id} tab={activeTab} />
  );
}

function EmptyState() {
  const newQuery = useStudioStore((s) => s.newQuery);
  return (
    <Box
      sx={{
        display: "flex",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Stack spacing={1.5} sx={{ alignItems: "center", maxWidth: 420, textAlign: "center" }}>
        <Terminal style={{ width: 32, height: 32, color: "var(--muted-foreground)", opacity: 0.5 }} />
        <Box>
          <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
            Welcome to the database studio
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 13.5, color: "var(--muted-foreground)" }}>
            Pick a table from the sidebar to browse its data and structure, or open a query tab to run SQL.
          </Typography>
        </Box>
        <Button type="button" variant="contained" size="small" onClick={newQuery}>
          New query
        </Button>
      </Stack>
    </Box>
  );
}
