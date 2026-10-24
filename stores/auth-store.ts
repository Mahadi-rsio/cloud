import { create } from "zustand";

export type AuthMode = "signin" | "signup";

interface AuthStore {
  mode: AuthMode;
  submitting: boolean;
  error: string | null;
  setMode: (mode: AuthMode) => void;
  setSubmitting: (submitting: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  mode: "signin",
  submitting: false,
  error: null,
  setMode: (mode) => set({ mode, error: null }),
  setSubmitting: (submitting) => set({ submitting }),
  setError: (error) => set({ error }),
}));