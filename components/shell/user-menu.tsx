"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, LogOut, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";
import { UserAvatar } from "@/components/shell/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const theme = useThemeStore();

  useEffect(() => {
    theme.init();
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded-full p-1 text-foreground">
        <UserAvatar name={user.name} />
        <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-64">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
          <span className="text-sm text-foreground">Theme</span>
          <ThemeToggleButton />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/billing")}>
          <CreditCard className="size-4" />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await api.post("/sign-out", {});
            router.push("/login");
            router.refresh();
          }}
        >
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}