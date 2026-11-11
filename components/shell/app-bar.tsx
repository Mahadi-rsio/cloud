"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import MuiAppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

  return (
    <Breadcrumbs
      separator={<span className="text-muted-foreground text-xs">/</span>}
      aria-label="breadcrumb"
      sx={{
        display: { xs: "none", md: "flex" },
        "& .MuiBreadcrumbs-li": {
          fontSize: "0.875rem",
          fontWeight: 600,
        },
      }}
    >
      <Typography
        sx={{
          color: "var(--muted-foreground)",
          fontSize: "0.875rem",
          fontWeight: 600,
        }}
      >
        Cloudisy
      </Typography>
      {section && (
        <Typography
          sx={{
            color: "var(--foreground)",
            fontSize: "0.875rem",
            fontWeight: 600,
          }}
        >
          {section}
        </Typography>
      )}
    </Breadcrumbs>
  );
}

function CommandSearch() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="hidden h-9 w-48 lg:w-56 justify-start gap-2 px-3 text-muted-foreground sm:flex border-border/80 bg-background/50 hover:bg-accent/60"
        >
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left text-xs font-normal">
            Search…
          </span>
          <kbd className="pointer-events-none rounded border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      </DialogTrigger>
      <DialogTrigger asChild>
        <IconButton
          size="small"
          className="sm:hidden"
          aria-label="Search"
          sx={{
            color: "var(--muted-foreground)",
            borderRadius: "8px",
            "&:hover": {
              backgroundColor: "var(--accent)",
              color: "var(--foreground)",
            },
          }}
        >
          <Search className="size-4.5" />
        </IconButton>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>
            Quickly jump to any resource or page across your projects.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-xl border border-input bg-card/60 px-3 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="border-0 bg-transparent shadow-none dark:bg-transparent h-9 px-1 focus:ring-0"
            placeholder="Search apps, databases, storage..."
            aria-label="Search"
            autoFocus
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: You can use the sidebar to quickly navigate between services.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function AppBar({ user }: { user: { name: string; email: string } }) {
  const shell = useShellStore();

  return (
    <MuiAppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: "rgba(13, 20, 24, 0.85)",
        backdropFilter: "blur(12px)",
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
          <Menu className="size-5" />
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
