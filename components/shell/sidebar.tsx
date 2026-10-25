"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import {
  AppWindow,
  BookOpen,
  Cloud,
  CreditCard,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { api } from "@/lib/api";
import { useShellStore } from "@/stores/shell-store";
import { useThemeStore } from "@/stores/theme-store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UserAvatar } from "@/components/shell/user-avatar";

const NAV_LINKS = [
  { href: "/apps", label: "Apps", icon: AppWindow },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/privacy", label: "Privacy policy", icon: ShieldCheck },
] as const;

function AccountSection({ user }: { user: { name: string; email: string } }) {
  const theme = useThemeStore();

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <UserAvatar name={user.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {user.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {user.email}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
        <span className="flex items-center gap-2 text-sm text-foreground">
          {theme.theme === "dark" ? (
            <Moon className="size-4" />
          ) : (
            <Sun className="size-4" />
          )}
          Dark mode
        </span>
        <ThemeToggle />
      </div>
    </div>
  );
}

export function Sidebar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const shell = useShellStore();

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <a
              key={href}
              href={href}
              onClick={() => shell.setSidebarOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active &&
                  "bg-accent text-accent-foreground focus-visible:ring-accent"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{label}</span>
            </a>
          );
        })}
      </nav>
      <div className="mt-auto" />
      <AccountSection user={user} />
    </div>
  );
}

export function MobileSidebar({
  user,
}: {
  user: { name: string; email: string };
}) {
  const shell = useShellStore();
  const router = useRouter();

  return (
    <Dialog.Root
      open={shell.sidebarOpen}
      onOpenChange={(open) => shell.setSidebarOpen(open)}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-background shadow-lg">
          <div className="flex items-center gap-2 border-b px-3 py-3">
            <Cloud className="size-5 shrink-0 text-primary" />
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Cloud
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-8"
              aria-label="Close menu"
              onClick={() => shell.setSidebarOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
          <Sidebar user={user} />
          <div className="border-t px-3 py-2">
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-destructive-foreground outline-none transition-colors hover:bg-destructive/10"
              onClick={async () => {
                await api.post("/sign-out", {});
                shell.setSidebarOpen(false);
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOut className="size-4 shrink-0" />
              Log out
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}