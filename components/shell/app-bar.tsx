"use client";

import * as React from "react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import MuiAppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import { Menu, Search } from "lucide-react";
import { useShellStore } from "@/stores/shell-store";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";
import { UserMenu } from "@/components/shell/user-menu";
import { Wordmark } from "@/components/shell/wordmark";

const SECTION_LABELS: Record<string, string> = {
  apps: "Apps",
  storage: "Storage",
  databases: "Databases",
  domains: "Domains",
  billing: "Billing",
  settings: "Settings",
  docs: "Docs",
};

function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const section = segments[0] ? SECTION_LABELS[segments[0]] ?? segments[0] : null;

  if (!section) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Typography
        sx={{
          display: { xs: "none", md: "inline" },
          color: "var(--foreground)",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
      >
        {section}
      </Typography>
    </Box>
  );
}

function CommandSearch() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outlined"
        size="small"
        onClick={() => setOpen(true)}
        sx={{
          display: { xs: "none", sm: "flex" },
          height: 36,
          width: { sm: 192, lg: 224 },
          justifyContent: "flex-start",
          gap: 1,
          px: 1.5,
          color: "var(--muted-foreground)",
          borderColor: "var(--border)",
          backgroundColor: "transparent",
          fontWeight: 400,
          "&:hover": {
            backgroundColor: "var(--accent)",
            borderColor: "var(--border)",
          },
        }}
      >
        <Search size={16} style={{ flexShrink: 0 }} />
        <Typography
          component="span"
          noWrap
          sx={{ flex: 1, textAlign: "left", fontSize: "0.75rem", fontWeight: 400 }}
        >
          Search…
        </Typography>
        <Box
          component="kbd"
          sx={{
            pointerEvents: "none",
            borderRadius: "4px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--muted)",
            px: 0.75,
            py: 0.25,
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            lineHeight: 1.2,
            color: "var(--muted-foreground)",
          }}
        >
          ⌘K
        </Box>
      </Button>

      <IconButton
        size="small"
        aria-label="Search"
        onClick={() => setOpen(true)}
        sx={{
          display: { xs: "inline-flex", sm: "none" },
          color: "var(--muted-foreground)",
          borderRadius: "8px",
          "&:hover": {
            backgroundColor: "var(--accent)",
            color: "var(--foreground)",
          },
        }}
      >
        <Search size={18} />
      </IconButton>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ pb: 0.5 }}>Search</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Quickly jump to any resource or page across your projects.
          </Typography>
          <TextField
            fullWidth
            size="small"
            placeholder="Search apps, databases, storage..."
            autoFocus
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Tip: You can use the sidebar to quickly navigate between services.
          </Typography>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppBar({ user }: { user: { name: string; email: string } }) {
  const shell = useShellStore();

  return (
    <MuiAppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: "color-mix(in oklab, var(--card) 92%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
        color: "var(--foreground)",
        zIndex: 30,
      }}
    >
      <Toolbar
        variant="dense"
        sx={{
          minHeight: { xs: 56, sm: 60 },
          px: { xs: 2, sm: 3 },
          gap: { xs: 1, sm: 2 },
          display: "flex",
          alignItems: "center",
        }}
      >
        <IconButton
          edge="start"
          aria-label="Open menu"
          onClick={() => shell.setSidebarOpen(true)}
          sx={{
            display: { md: "none" },
            color: "var(--foreground)",
            borderRadius: "8px",
            mr: 0.5,
          }}
        >
          <Menu size={20} />
        </IconButton>

        <Box sx={{ display: { xs: "flex", md: "none" }, alignItems: "center" }}>
          <Wordmark />
        </Box>

        <Breadcrumb />

        <Box sx={{ flexGrow: 1 }} />

        <CommandSearch />

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ThemeToggleButton />
          <UserMenu user={user} />
        </Box>
      </Toolbar>
    </MuiAppBar>
  );
}
