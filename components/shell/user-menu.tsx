"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, LogOut, Moon, Settings, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { api } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { UserAvatar } from "@/components/shell/user-avatar";

export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const theme = useThemeStore();

  useEffect(() => {
    theme.init();
  }, []);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-full p-1 text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-accent">
        <UserAvatar name={user.name} />
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="w-64 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-foreground">
              {user.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
          <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-foreground">
            <span className="flex items-center gap-2">
              {theme.theme === "dark" ? (
                <Moon className="size-4" />
              ) : (
                <Sun className="size-4" />
              )}
              Dark mode
            </span>
            <ThemeToggle />
          </div>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={() => router.push("/billing")}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <CreditCard className="size-4 shrink-0" />
            Billing
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => router.push("/settings")}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <Settings className="size-4 shrink-0" />
            Settings
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={async () => {
              await api.post("/sign-out", {});
              router.push("/login");
              router.refresh();
            }}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive-foreground"
          >
            <LogOut className="size-4 shrink-0" />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}