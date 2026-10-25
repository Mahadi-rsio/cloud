"use client";

import { Cloud, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShellStore } from "@/stores/shell-store";
import { UserMenu } from "@/components/shell/user-menu";

export function AppBar({ user }: { user: { name: string; email: string } }) {
  const shell = useShellStore();

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-md">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open menu"
        onClick={() => shell.setSidebarOpen(true)}
      >
        <Menu />
      </Button>
      <div className="flex items-center gap-2">
        <Cloud className="size-5 shrink-0 text-primary" />
        <span className="text-lg font-semibold tracking-tight text-foreground">
          Cloud
        </span>
      </div>
      <div className="ml-auto flex items-center">
        <UserMenu user={user} />
      </div>
    </header>
  );
}