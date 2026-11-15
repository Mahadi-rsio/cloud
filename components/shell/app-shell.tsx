"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import { AppWindow, Database, HardDrive, Menu } from "lucide-react";
import { Sidebar, MobileSidebar } from "@/components/shell/sidebar";
import { AppBar } from "@/components/shell/app-bar";
import { useShellStore } from "@/stores/shell-store";

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
    <Box
      sx={{
        display: "flex",
        minHeight: "100dvh",
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      <DesktopRail user={user} />
      <MobileSidebar user={user} />
      <Box
        component="div"
        sx={{
          display: "flex",
          minHeight: 0,
          minWidth: 0,
          flex: "1 1 0%",
          flexDirection: "column",
        }}
      >
        <AppBar user={user} />
        <Box
          component="main"
          sx={{
            display: "flex",
            minHeight: 0,
            flex: "1 1 0%",
            flexDirection: "column",
            overflowY: "auto",
            overflowX: "hidden",
            px: { xs: 1.5, sm: 3, md: 4.5 },
            pt: { xs: 2, sm: 3, md: 4 },
            pb: { xs: "calc(76px + env(safe-area-inset-bottom, 0px))", md: 4 },
          }}
        >
          {children}
        </Box>
        <MobileBottomNav />
      </Box>
    </Box>
  );
}

const MOBILE_NAV_ITEMS = [
  { href: "/apps", label: "Apps", icon: AppWindow },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/storage", label: "Storage", icon: HardDrive },
] as const;

function MobileBottomNav() {
  const pathname = usePathname();
  const setSidebarOpen = useShellStore((state) => state.setSidebarOpen);

  return (
    <Box
      component="nav"
      aria-label="Mobile navigation"
      sx={{
        display: { xs: "flex", md: "none" },
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 35,
        height: "calc(60px + env(safe-area-inset-bottom, 0px))",
        pb: "env(safe-area-inset-bottom, 0px)",
        borderTop: "1px solid var(--border)",
        backgroundColor: "color-mix(in oklab, var(--card) 94%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        alignItems: "stretch",
      }}
    >
      {MOBILE_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <ButtonBase
            key={href}
            component="a"
            href={href}
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.375,
              color: active ? "var(--primary)" : "var(--muted-foreground)",
              transition: "color 0.15s ease",
            }}
          >
            <Icon size={19} />
            <Typography
              component="span"
              sx={{
                fontSize: "0.6875rem",
                fontWeight: active ? 600 : 500,
                lineHeight: 1,
              }}
            >
              {label}
            </Typography>
          </ButtonBase>
        );
      })}
      <ButtonBase
        type="button"
        onClick={() => setSidebarOpen(true)}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.375,
          color: "var(--muted-foreground)",
        }}
      >
        <Menu size={19} />
        <Typography
          component="span"
          sx={{ fontSize: "0.6875rem", fontWeight: 500, lineHeight: 1 }}
        >
          More
        </Typography>
      </ButtonBase>
    </Box>
  );
}

function DesktopRail({ user }: { user: ShellUser }) {
  const collapsed = useShellStore((state) => state.railCollapsed);
  const railWidth = collapsed ? 64 : 240;

  return (
    <Box
      component="aside"
      sx={{
        display: { xs: "none", md: "flex" },
        width: railWidth,
        flexShrink: 0,
        transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <Box
        sx={{
          position: "sticky",
          top: 0,
          display: "flex",
          height: "100vh",
          width: railWidth,
          flexShrink: 0,
          flexDirection: "column",
          borderRight: "1px solid var(--border)",
          backgroundColor: "var(--background)",
          transition: "width 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          overflowX: "hidden",
        }}
      >
        <Sidebar user={user} collapsed={collapsed} />
      </Box>
    </Box>
  );
}
