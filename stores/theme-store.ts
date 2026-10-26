import { create } from "zustand";

export type Theme = "light" | "dark";

const THEME_KEY = "theme";

export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // ignore
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function persistTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
}

interface ThemeStore {
  theme: Theme;
  init: () => void;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: "dark",
  init: () => {
    const theme = getStoredTheme();
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  toggle: () => {
    const theme =
      useThemeStore.getState().theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
}));