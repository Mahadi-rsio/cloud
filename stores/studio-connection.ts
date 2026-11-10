import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface StudioConnectionStore {
  databaseId: string;
  name: string;
  connected: boolean;
  connect: (databaseId: string, name: string, connected: boolean) => void;
  setConnected: (connected: boolean) => void;
  disconnect: () => void;
  clear: () => void;
}

export const useStudioConnectionStore = create<StudioConnectionStore>()(
  persist(
    (set) => ({
      databaseId: "",
      name: "",
      connected: false,

      connect: (databaseId, name, connected) => set({ databaseId, name, connected }),
      setConnected: (connected) => set({ connected }),
      disconnect: () => set({ connected: false }),
      clear: () => set({ databaseId: "", name: "", connected: false }),
    }),
    {
      name: "studio-connection",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);