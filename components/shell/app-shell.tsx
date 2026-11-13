"use client";

import * as React from "react";
import Box from "@mui/material/Box";
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
        minHeight: "100vh",
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
            px: { xs: 2, sm: 3.5, md: 5 },
            py: { xs: 3, sm: 4, md: 5 },
          }}
        >
          {children}
        </Box>
      </Box>
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
