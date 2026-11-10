"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { ArrowLeft, Menu, Plug, RefreshCw, Terminal } from "lucide-react";
import { useStudioStore } from "@/stores/studio-store";
import { useStudioConnectionStore } from "@/stores/studio-connection";
import { Sidebar } from "@/components/studio/Sidebar";
import { TabBar } from "@/components/studio/TabBar";
import { TableView } from "@/components/studio/TableView";
import { QueryView } from "@/components/studio/QueryView";
import { ConnectScreen } from "@/components/studio/ConnectScreen";
import { Button } from "@/components/ui/button";

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
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const toggleSidebar = useStudioStore((s) => s.toggleSidebar);

  const connected = useStudioConnectionStore((s) => s.connected);
  const connectionName = useStudioConnectionStore((s) => s.name);
  const disconnect = useStudioConnectionStore((s) => s.disconnect);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 sm:hidden"
          onClick={toggleSidebar}
          title="Toggle sidebar"
        >
          <Menu className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Terminal className="size-4 text-primary" />
          <span className="text-sm font-semibold">Lite Studio</span>
        </div>

        {connected && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-1 h-7 max-w-[220px] gap-1.5 px-2 text-xs"
            onClick={disconnect}
            title="Change connection"
          >
            <Plug className="size-3.5 shrink-0 text-emerald-500" />
            <span className="truncate">{connectionName || "Connected"}</span>
          </Button>
        )}

        <div className="flex-1" />
        {connected && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8"
            title="Refresh database metadata"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["studio"] });
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
        )}
        <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
          <a href="/databases">
            <ArrowLeft className="size-3.5" />
            Dashboard
          </a>
        </Button>
      </header>

      {connected ? (
        <div className="flex min-h-0 flex-1">
          {/* Mobile drawer */}
          {sidebarOpen && (
            <div className="fixed inset-0 z-50 sm:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={toggleSidebar} />
              <div className="absolute top-0 left-0 h-full w-72 border-r bg-background">
                <Sidebar />
              </div>
            </div>
          )}

          {/* Desktop resizable layout */}
          <PanelGroup direction="horizontal" className="hidden min-h-0 flex-1 sm:flex">
            <Panel defaultSize={18} minSize={12} maxSize={35} className="min-w-0">
              <Sidebar />
            </Panel>
            <PanelResizeHandle className="w-px bg-border transition-colors data-[resize-handle-active]:bg-primary" />
            <Panel className="min-w-0">
              <Workspace activeTabId={activeTabId} />
            </Panel>
          </PanelGroup>

          {/* Mobile stacked layout */}
          <div className="flex min-h-0 flex-1 flex-col sm:hidden">
            <TabBar />
            <div className="min-h-0 flex-1">
              <WorkspaceContent activeTabId={activeTabId} />
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ConnectScreen />
        </div>
      )}
    </div>
  );
}

function Workspace({ activeTabId }: { activeTabId: string | null }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        <WorkspaceContent activeTabId={activeTabId} />
      </div>
    </div>
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
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <Terminal className="size-8 text-muted-foreground/50" />
        <div>
          <h2 className="text-base font-semibold">Welcome to the database studio</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a table from the sidebar to browse its data and structure, or open a
            query tab to run SQL.
          </p>
        </div>
        <Button type="button" size="sm" onClick={newQuery}>
          New query
        </Button>
      </div>
    </div>
  );
}