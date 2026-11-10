import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type StudioTabKind = "table" | "query";

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

export type StudioTableView = "data" | "structure";

export interface StudioTableViewState {
  page: number;
  sort: StudioSortSpec | null;
  view: StudioTableView;
}

const DEFAULT_TABLE_STATE: StudioTableViewState = { page: 0, sort: null, view: "data" };
const DEFAULT_QUERY = "SELECT * FROM sqlite_master LIMIT 20;";
const HISTORY_LIMIT = 50;

interface StudioStore {
  tabs: StudioTab[];
  activeTabId: string | null;
  sidebarOpen: boolean;
  history: string[];
  tableStates: Record<string, StudioTableViewState>;
  openTable: (table: string) => void;
  openQuery: (sql?: string) => void;
  newQuery: () => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setSql: (id: string, sql: string) => void;
  toggleSidebar: () => void;
  addHistory: (sql: string) => void;
  clearHistory: () => void;
  setPage: (table: string, page: number) => void;
  setSort: (table: string, sort: StudioSortSpec | null) => void;
  setView: (table: string, view: StudioTableView) => void;
  reset: () => void;
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

function tableState(
  tableStates: Record<string, StudioTableViewState>,
  table: string,
): StudioTableViewState {
  return tableStates[table] ?? DEFAULT_TABLE_STATE;
}

export const useStudioStore = create<StudioStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      sidebarOpen: false,
      history: [],
      tableStates: {},

      openTable: (table) => {
        const existing = get().tabs.find((tab) => tab.kind === "table" && tab.table === table);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const id = nextId("tab");
        const tab: StudioTab = { id, kind: "table", title: table, table, sql: "" };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
      },

      openQuery: (sql) => {
        const id = nextId("tab");
        const number = get().tabs.filter((tab) => tab.kind === "query").length + 1;
        const tab: StudioTab = {
          id,
          kind: "query",
          title: `Query ${number}`,
          sql: sql ?? DEFAULT_QUERY,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
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

      setActiveTab: (id) => set({ activeTabId: id }),
      setSql: (id, sql) =>
        set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, sql } : tab)) })),

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

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

      setPage: (table, page) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...tableState(s.tableStates, table), page },
          },
        })),

      setSort: (table, sort) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...tableState(s.tableStates, table), sort },
          },
        })),

      setView: (table, view) =>
        set((s) => ({
          tableStates: {
            ...s.tableStates,
            [table]: { ...tableState(s.tableStates, table), view },
          },
        })),

      reset: () => set({ tabs: [], activeTabId: null, history: [], tableStates: {} }),
    }),
    {
      name: "studio-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        history: state.history,
        tableStates: state.tableStates,
      }),
    },
  ),
);