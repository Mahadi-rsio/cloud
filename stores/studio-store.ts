import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StudioFilterCondition } from "@/lib/studio/types";

export type StudioTabKind = "table" | "query" | "schema";

export interface StudioTab {
  id: string;
  kind: StudioTabKind;
  title: string;
  table?: string;
  sql: string;
}

export interface StudioSortSpec {
  column: string;
  dir: "asc" | "desc";
}

export type StudioTableView = "data" | "structure" | "ddl";

export interface StudioTableViewState {
  page: number;
  pageSize: number;
  sort: StudioSortSpec | null;
  view: StudioTableView;
  filters: StudioFilterCondition[];
  search: string;
}

export interface SavedQueryItem {
  id: string;
  name: string;
  sql: string;
  createdAt: string;
}

export const DEFAULT_TABLE_STATE: StudioTableViewState = {
  page: 0,
  pageSize: 50,
  sort: null,
  view: "data",
  filters: [],
  search: "",
};

const DEFAULT_QUERY =
  "-- Write a SQLite query below and press Run (or Cmd/Ctrl + Enter)\nSELECT name, type\nFROM sqlite_master\nWHERE type = 'table' AND name NOT LIKE 'sqlite_%'\nORDER BY name;";
const HISTORY_LIMIT = 50;

interface StudioStore {
  tabs: StudioTab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  history: string[];
  savedQueries: SavedQueryItem[];
  tableStates: Record<string, StudioTableViewState>;
  openTable: (table: string, initialView?: StudioTableView) => void;
  openSchemaOverview: () => void;
  openQuery: (sql?: string, title?: string) => void;
  newQuery: () => void;
  closeTab: (id: string) => void;
  closeTableTab: (table: string) => void;
  renameTableTab: (oldName: string, newName: string) => void;
  setActiveTab: (id: string) => void;
  setSql: (id: string, sql: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  addHistory: (sql: string) => void;
  clearHistory: () => void;
  saveQuery: (name: string, sql: string) => void;
  deleteSavedQuery: (id: string) => void;
  setPage: (table: string, page: number) => void;
  setPageSize: (table: string, pageSize: number) => void;
  setSort: (table: string, sort: StudioSortSpec | null) => void;
  setView: (table: string, view: StudioTableView) => void;
  setFilters: (table: string, filters: StudioFilterCondition[]) => void;
  setSearch: (table: string, search: string) => void;
  reset: () => void;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function getTableState(
  tableStates: Record<string, StudioTableViewState>,
  table: string,
): StudioTableViewState {
  const existing = tableStates[table];
  if (!existing) return DEFAULT_TABLE_STATE;
  return {
    ...DEFAULT_TABLE_STATE,
    ...existing,
    filters: Array.isArray(existing.filters) ? existing.filters : [],
    search: typeof existing.search === "string" ? existing.search : "",
    pageSize: typeof existing.pageSize === "number" ? existing.pageSize : 50,
  };
}

export const useStudioStore = create<StudioStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      sidebarOpen: false,
      history: [],
      savedQueries: [],
      tableStates: {},

      openTable: (table, initialView) => {
        const existing = get().tabs.find((tab) => tab.kind === "table" && tab.table === table);
        if (existing) {
          set((s) => ({
            activeTabId: existing.id,
            sidebarOpen: false,
            ...(initialView
              ? {
                  tableStates: {
                    ...s.tableStates,
                    [table]: { ...getTableState(s.tableStates, table), view: initialView },
                  },
                }
              : {}),
          }));
          return;
        }
        const id = nextId("tab");
        const tab: StudioTab = { id, kind: "table", title: table, table, sql: "" };
        set((s) => ({
          tabs: [...s.tabs, tab],
          activeTabId: id,
          sidebarOpen: false,
          ...(initialView
            ? {
                tableStates: {
                  ...s.tableStates,
                  [table]: { ...getTableState(s.tableStates, table), view: initialView },
                },
              }
            : {}),
        }));
      },

      openSchemaOverview: () => {
        const existing = get().tabs.find((tab) => tab.kind === "schema");
        if (existing) {
          set({ activeTabId: existing.id, sidebarOpen: false });
          return;
        }
        const id = nextId("schema");
        const tab: StudioTab = {
          id,
          kind: "schema",
          title: "Schema Explorer",
          sql: "",
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id, sidebarOpen: false }));
      },

      openQuery: (sql, customTitle) => {
        const id = nextId("tab");
        const number = get().tabs.filter((tab) => tab.kind === "query").length + 1;
        const tab: StudioTab = {
          id,
          kind: "query",
          title: customTitle ?? `Query ${number}`,
          sql: sql ?? DEFAULT_QUERY,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id, sidebarOpen: false }));
      },

      newQuery: () => get().openQuery(),

      closeTab: (id) => {
        set((s) => {
          const index = s.tabs.findIndex((tab) => tab.id === id);
          const tabs = s.tabs.filter((tab) => tab.id !== id);
          let activeTabId = s.activeTabId;
          if (activeTabId === id) {
            activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
          }
          return { tabs, activeTabId };
        });
      },

      closeTableTab: (table) => {
        const tab = get().tabs.find((t) => t.kind === "table" && t.table === table);
        if (tab) {
          get().closeTab(tab.id);
        }
      },

      renameTableTab: (oldName, newName) => {
        set((s) => {
          const nextStates = { ...s.tableStates };
          if (nextStates[oldName]) {
            nextStates[newName] = nextStates[oldName];
            delete nextStates[oldName];
          }
          return {
            tableStates: nextStates,
            tabs: s.tabs.map((tab) =>
              tab.kind === "table" && tab.table === oldName
                ? { ...tab, table: newName, title: newName }
                : tab,
            ),
          };
        });
      },

      setActiveTab: (id) => set({ activeTabId: id }),
      setSql: (id, sql) =>
        set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, sql } : tab)) })),

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      addHistory: (sql) =>
        set((s) => {
          const trimmed = sql.trim();
          if (!trimmed) return s;
          const history = [trimmed, ...s.history.filter((item) => item !== trimmed)].slice(
            0,
            HISTORY_LIMIT,
          );
          return { history };
        }),

      clearHistory: () => set({ history: [] }),

      saveQuery: (name, sql) =>
        set((s) => {
          const trimmedName = name.trim() || "Saved Query";
          const trimmedSql = sql.trim();
          if (!trimmedSql) return s;
          const item: SavedQueryItem = {
            id: nextId("sq"),
            name: trimmedName,
            sql: trimmedSql,
            createdAt: new Date().toISOString(),
          };
          return { savedQueries: [item, ...s.savedQueries] };
        }),

      deleteSavedQuery: (id) =>
        set((s) => ({
          savedQueries: s.savedQueries.filter((q) => q.id !== id),
        })),

      setPage: (table, page) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), page },
          },
        })),

      setPageSize: (table, pageSize) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), pageSize, page: 0 },
          },
        })),

      setSort: (table, sort) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), sort },
          },
        })),

      setView: (table, view) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), view },
          },
        })),

      setFilters: (table, filters) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), filters, page: 0 },
          },
        })),

      setSearch: (table, search) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...getTableState(s.tableStates, table), search, page: 0 },
          },
        })),

      reset: () => set({ tabs: [], activeTabId: null, tableStates: {} }),
    }),
    {
      name: "studio-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        history: state.history,
        savedQueries: state.savedQueries,
        tableStates: state.tableStates,
      }),
    },
  ),
);
