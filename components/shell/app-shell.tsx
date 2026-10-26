import * as React from "react";
import { Sidebar, MobileSidebar } from "@/components/shell/sidebar";
import { AppBar } from "@/components/shell/app-bar";

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
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-background md:flex">
        <Sidebar user={user} />
      </aside>
      <MobileSidebar user={user} />
      <div className="flex min-h-0 flex-1 flex-col">
        <AppBar user={user} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}