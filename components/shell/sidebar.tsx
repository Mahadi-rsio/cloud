"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "cn";
import {
  AppWindow,
  BookOpen,
  CreditCard,
  Database,
  GitBranch,
  Globe,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { api } from "@/lib/api";
import { useShellStore } from "@/stores/shell-store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Wordmark } from "@/components/shell/wordmark";
import { UserAvatar } from "@/components/shell/user-avatar";

const PRIMARY_NAV = [
  { href: "/apps", label: "Apps", icon: AppWindow },
  { href: "/github", label: "GitHub", icon: GitBranch },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/domains", label: "Domains", icon: Globe },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const SECONDARY_NAV = [
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/privacy", label: "Privacy policy", icon: ShieldCheck },
] as const;

function NavItem({
  href,
  label,
  icon: Icon,
  collapsed,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof AppWindow;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  const item = (
    <a
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg text-sm font-semibold text-muted-foreground outline-none transition-colors",
        "hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        active && "bg-accent text-foreground",
        collapsed ? "justify-center px-0" : "px-3"
      )}
    >
      <Icon className="size-4.5 shrink-0" />
      {!collapsed && <span className="flex-1 truncate text-left">{label}</span>}
    </a>
  );

  if (!collapsed) return item;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({
  user,
  collapsed,
}: {
  user: { name: string; email: string };
  collapsed: boolean;
}) {
  const shell = useShellStore();

  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <div className={cn("flex items-center", collapsed ? "justify-center" : "px-1")}>
        <Wordmark collapsed={collapsed} />
      </div>
      <nav className="flex flex-col gap-1" aria-label="Main">
        {PRIMARY_NAV.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            collapsed={collapsed}
            onNavigate={() => shell.setSidebarOpen(false)}
          />
        ))}
      </nav>
      <div className="mt-auto" />
      <nav className="flex flex-col gap-1" aria-label="Support">
        {SECONDARY_NAV.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            collapsed={collapsed}
            onNavigate={() => shell.setSidebarOpen(false)}
          />
        ))}
      </nav>
      <div className={cn("flex flex-col gap-2 border-t pt-3", collapsed && "items-center")}>
        <div className={cn("flex items-center gap-2.5 px-1", collapsed && "px-0")}>
          <UserAvatar name={user.name} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {user.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className={cn("text-muted-foreground", !collapsed && "justify-start px-3")}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => shell.setRailCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <>
              <PanelLeftClose className="size-4" />
              <span>Collapse</span>
            </>
          )}
        </Button>
      </div>
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
    <DialogPrimitive.Root open={shell.sidebarOpen} onOpenChange={shell.setSidebarOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-background shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Wordmark />
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
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <nav className="flex flex-col gap-1" aria-label="Main">
              {PRIMARY_NAV.map((link) => (
                <NavItem
                  key={link.href}
                  {...link}
                  collapsed={false}
                  onNavigate={() => shell.setSidebarOpen(false)}
                />
              ))}
            </nav>
            <nav className="mt-6 flex flex-col gap-1" aria-label="Support">
              {SECONDARY_NAV.map((link) => (
                <NavItem
                  key={link.href}
                  {...link}
                  collapsed={false}
                  onNavigate={() => shell.setSidebarOpen(false)}
                />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2.5 border-t px-4 py-3">
            <UserAvatar name={user.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {user.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </div>
            <button
              type="button"
              aria-label="Log out"
              className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={async () => {
                await api.post("/sign-out", {});
                shell.setSidebarOpen(false);
                router.push("/login");
                router.refresh();
              }}
            >
              <LogOut className="size-4.5" />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}