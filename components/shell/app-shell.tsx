"use client";

import * as React from "react";
import { Sidebar, MobileSidebar } from "@/components/shell/sidebar";
import { AppBar } from "@/components/shell/app-bar";
import { useShellStore } from "@/stores/shell-store";
import { TooltipProvider } from "@/components/ui/tooltip";

export interface ShellUser {
  name: string;
  email: string;
}

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-svh bg-background text-foreground">
        <DesktopRail user={user} />
        <MobileSidebar user={user} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <AppBar user={user} />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function DesktopRail({ user }: { user: ShellUser }) {
  const collapsed = useShellStore((state) => state.railCollapsed);
  return (
    <aside
      className={collapsed ? "hidden w-16 md:flex" : "hidden w-60 md:flex"}
    >
      <div
        className={
          "sticky top-0 flex h-svh shrink-0 flex-col border-r bg-background transition-[width] duration-200 " +
          (collapsed ? "w-16" : "w-60")
        }
      >
        <Sidebar user={user} collapsed={collapsed} />
      </div>
    </aside>
  );
}