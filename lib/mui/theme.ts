import { createTheme, responsiveFontSizes, type ThemeOptions } from "@mui/material/styles";

const baseThemeOptions: ThemeOptions = {
  typography: {
    fontFamily: "var(--font-hanken), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 700, letterSpacing: "-0.025em" },
    h2: { fontWeight: 700, letterSpacing: "-0.025em" },
    h3: { fontWeight: 600, letterSpacing: "-0.02em" },
    h4: { fontWeight: 600, letterSpacing: "-0.015em" },
    h5: { fontWeight: 600, letterSpacing: "-0.01em" },
    h6: { fontWeight: 600, letterSpacing: "-0.005em" },
    subtitle1: { fontSize: "1rem", lineHeight: 1.5 },
    subtitle2: { fontSize: "0.875rem", lineHeight: 1.43, fontWeight: 500 },
    body1: { fontSize: "0.9375rem", lineHeight: 1.5 },
    body2: { fontSize: "0.8125rem", lineHeight: 1.43 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: "-0.01em" },
    caption: { fontSize: "0.75rem", lineHeight: 1.33 },
    overline: { letterSpacing: "0.08em", fontWeight: 700 },
  },
  shape: {
    borderRadius: 10,
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
    },
  },
};

export const darkTheme = responsiveFontSizes(
  createTheme({
    ...baseThemeOptions,
    palette: {
      mode: "dark",
      primary: {
        main: "#38bdf8",
        light: "#7dd3fc",
        dark: "#0284c7",
        contrastText: "#082032",
      },
      secondary: {
        main: "#94a3b8",
        light: "#cbd5e1",
        dark: "#475569",
        contrastText: "#0f172a",
      },
      background: {
        default: "#0d1418",
        paper: "#141e24",
      },
      text: {
        primary: "#e8eff2",
        secondary: "#8a9da6",
        disabled: "#51626c",
      },
      divider: "rgba(255, 255, 255, 0.08)",
      error: {
        main: "#e5484d",
        light: "#f87171",
        dark: "#b91c1c",
        contrastText: "#ffffff",
      },
      warning: {
        main: "#f5a524",
        light: "#fbbf24",
        dark: "#d97706",
        contrastText: "#1c1917",
      },
      success: {
        main: "#3dd68c",
        light: "#4ade80",
        dark: "#16a34a",
        contrastText: "#064e3b",
      },
      info: {
        main: "#38bdf8",
        light: "#7dd3fc",
        dark: "#0284c7",
        contrastText: "#082032",
      },
      action: {
        hover: "rgba(255, 255, 255, 0.05)",
        selected: "rgba(56, 189, 248, 0.12)",
        disabled: "rgba(255, 255, 255, 0.26)",
        disabledBackground: "rgba(255, 255, 255, 0.08)",
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: "#0d1418",
            color: "#e8eff2",
            scrollbarColor: "#243239 #0d1418",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            boxShadow: "none",
            whiteSpace: "nowrap",
            "&:hover": {
              boxShadow: "none",
            },
            "&:focus-visible": {
              outline: "2px solid #38bdf8",
              outlineOffset: 2,
            },
          },
          contained: {
            "&.MuiButton-containedPrimary": {
              backgroundColor: "#38bdf8",
              color: "#082032",
              "&:hover": {
                backgroundColor: "#7dd3fc",
              },
            },
          },
          outlined: {
            borderColor: "rgba(255, 255, 255, 0.08)",
            "&:hover": {
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56, 189, 248, 0.06)",
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: "#141e24",
            border: "1px solid rgba(255, 255, 255, 0.08)",
          },
          elevation1: {
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.37), 0 1px 2px -1px rgba(0, 0, 0, 0.37)",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: "#141e24",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 16,
            backgroundImage: "none",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.25)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            "&:hover": {
              borderColor: "rgba(255, 255, 255, 0.16)",
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: "#141e24",
            border: "1px solid #243239",
            borderRadius: 16,
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: "rgba(44, 59, 68, 0.3)",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "#2c3b44",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#3f5360",
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "#38bdf8",
              borderWidth: "1.5px",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
            whiteSpace: "nowrap",
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: "#1b272e",
            color: "#e8eff2",
            border: "1px solid #243239",
            fontSize: "0.75rem",
            borderRadius: 6,
            padding: "4px 8px",
          },
        },
      },
    },
  })
);

export const lightTheme = responsiveFontSizes(
  createTheme({
    ...baseThemeOptions,
    palette: {
      mode: "light",
      primary: {
        main: "#0284c7",
        light: "#38bdf8",
        dark: "#0369a1",
        contrastText: "#ffffff",
      },
      secondary: {
        main: "#64748b",
        light: "#94a3b8",
        dark: "#334155",
        contrastText: "#ffffff",
      },
      background: {
        default: "#f7f9fa",
        paper: "#ffffff",
      },
      text: {
        primary: "#0f1b21",
        secondary: "#5b6b74",
        disabled: "#94a3b8",
      },
      divider: "#d8e0e6",
      error: {
        main: "#dc2626",
        light: "#ef4444",
        dark: "#b91c1c",
        contrastText: "#ffffff",
      },
      warning: {
        main: "#d97706",
        light: "#f59e0b",
        dark: "#b45309",
        contrastText: "#ffffff",
      },
      success: {
        main: "#16a34a",
        light: "#22c55e",
        dark: "#15803d",
        contrastText: "#ffffff",
      },
      info: {
        main: "#0284c7",
        light: "#38bdf8",
        dark: "#0369a1",
        contrastText: "#ffffff",
      },
      action: {
        hover: "rgba(0, 0, 0, 0.04)",
        selected: "rgba(2, 132, 199, 0.08)",
        disabled: "rgba(0, 0, 0, 0.26)",
        disabledBackground: "rgba(0, 0, 0, 0.06)",
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: "#f7f9fa",
            color: "#0f1b21",
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            boxShadow: "none",
            whiteSpace: "nowrap",
            "&:hover": {
              boxShadow: "none",
            },
            "&:focus-visible": {
              outline: "2px solid #0284c7",
              outlineOffset: 2,
            },
          },
          contained: {
            "&.MuiButton-containedPrimary": {
              backgroundColor: "#0284c7",
              color: "#ffffff",
              "&:hover": {
                backgroundColor: "#0369a1",
              },
            },
          },
          outlined: {
            borderColor: "#d8e0e6",
            "&:hover": {
              borderColor: "#0284c7",
              backgroundColor: "rgba(2, 132, 199, 0.04)",
            },
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: "#ffffff",
            border: "1px solid #d8e0e6",
          },
          elevation1: {
            boxShadow: "0 1px 3px 0 rgba(0, 0, 0, 0.08), 0 1px 2px -1px rgba(0, 0, 0, 0.08)",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: "#ffffff",
            border: "1px solid #d8e0e6",
            borderRadius: 16,
            backgroundImage: "none",
            boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
            "&:hover": {
              borderColor: "#b6c5cf",
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: "#ffffff",
            border: "1px solid #d8e0e6",
            borderRadius: 16,
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundColor: "#ffffff",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "#d8e0e6",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: "#a3b4c0",
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "#0284c7",
              borderWidth: "1.5px",
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
            whiteSpace: "nowrap",
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: "#0f1b21",
            color: "#ffffff",
            border: "1px solid #334155",
            fontSize: "0.75rem",
            borderRadius: 6,
            padding: "4px 8px",
          },
        },
      },
    },
  })
);
