import { create } from "zustand";

interface StudioIntent {
  databaseId?: string;
  name?: string;
}

interface StudioIntentStore extends StudioIntent {
  setIntent: (intent: StudioIntent) => void;
  clearIntent: () => void;
}

/**
 * Holds a pending database chosen from the databases page so the studio can
 * auto-connect. Intentionally in-memory only (no persist middleware); the auth
 * token is resolved server-side from the database record and never touches the
 * client.
 */
export const useStudioIntentStore = create<StudioIntentStore>((set) => ({
  databaseId: undefined,
  name: undefined,
  setIntent: (intent) => set({ databaseId: intent.databaseId, name: intent.name }),
  clearIntent: () => set({ databaseId: undefined, name: undefined }),
}));