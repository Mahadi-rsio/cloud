import { create } from "zustand";

interface ShellStore {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellStore>((set) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));