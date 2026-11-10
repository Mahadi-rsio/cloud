"use client";

import { Plus, Table2, Terminal, X } from "lucide-react";
import { cn } from "cn";
import { useStudioStore } from "@/stores/studio-store";

export function TabBar() {
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const closeTab = useStudioStore((s) => s.closeTab);
  const newQuery = useStudioStore((s) => s.newQuery);

  return (
    <div className="flex h-9 shrink-0 items-center gap-px overflow-x-auto border-b bg-muted/30">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group flex max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border/60 px-3 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:bg-background/60",
            )}
            title={tab.title}
          >
            {tab.kind === "table" ? (
              <Table2 className="size-3.5 shrink-0 text-primary" />
            ) : (
              <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 data-[always]:opacity-100"
              data-always={active ? "true" : undefined}
              title="Close tab"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={newQuery}
        className="flex shrink-0 items-center gap-1 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        title="New query"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}