"use client";

import { usePathname } from "next/navigation";
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
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 md:flex">
      <span className="text-sm font-semibold text-muted-foreground">Cloudisy</span>
      {section && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">/</span>
          <span className="truncate text-sm font-semibold text-foreground">{section}</span>
        </>
      )}
    </nav>
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
          className="hidden h-9 w-56 justify-start gap-2 px-3 text-muted-foreground sm:flex"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search…</span>
          <kbd className="pointer-events-none rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </Button>
      </DialogTrigger>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Search"
        >
          <Search className="size-4.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search is coming soon.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/40 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            className="border-0 bg-transparent shadow-none dark:bg-transparent"
            placeholder="Search apps, databases, domains…"
            aria-label="Search"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Search is coming soon. Use the sidebar to navigate for now.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function AppBar({ user }: { user: { name: string; email: string } }) {
  const shell = useShellStore();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 md:hidden"
        aria-label="Open menu"
        onClick={() => shell.setSidebarOpen(true)}
      >
        <Menu className="size-4.5" />
      </Button>
      <span className="md:hidden">
        <Wordmark />
      </span>
      <Breadcrumb />
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggleButton />
        <UserMenu user={user} />
      </div>
      <CommandSearch />
    </header>
  );
}