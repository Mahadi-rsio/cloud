"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, Table2 } from "lucide-react";
import { cn } from "cn";
import { studioApi } from "@/lib/studio-api";
import { useStudioStore } from "@/stores/studio-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search tables"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="size-8 shrink-0"
          onClick={newQuery}
          title="New query"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {isPending ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {tables && tables.length === 0
              ? "No tables in this database."
              : "No tables match your search."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((table) => {
              const active = activeTable === table.name;
              return (
                <li key={table.name}>
                  <button
                    type="button"
                    onClick={() => openTable(table.name)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      active
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/60",
                    )}
                    title={`${table.name} · ${table.columnCount} columns`}
                  >
                    <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{table.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {table.columnCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}