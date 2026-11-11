"use client";

import * as React from "react";
import { ThemeProvider as MuiThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { darkTheme, lightTheme } from "./theme";
import { useThemeStore } from "@/stores/theme-store";

export function AppMuiProvider({ children }: { children: React.ReactNode }) {
  const currentTheme = useThemeStore((state) => state.theme);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    useThemeStore.getState().init();
  }, []);

  const theme = React.useMemo(() => {
    return currentTheme === "light" ? lightTheme : darkTheme;
  }, [currentTheme]);

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  );
}
