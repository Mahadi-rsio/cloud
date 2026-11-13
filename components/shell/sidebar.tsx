"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import {
  AppWindow,
  BookOpen,
  CreditCard,
  Database,
  Globe,
  HardDrive,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useShellStore } from "@/stores/shell-store";
import { Wordmark } from "@/components/shell/wordmark";
import { UserAvatar } from "@/components/shell/user-avatar";

const PRIMARY_NAV = [
  { href: "/apps", label: "Apps", icon: AppWindow },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/storage", label: "Storage", icon: HardDrive },
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

  const itemButton = (
    <ListItem disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        component="a"
        href={href}
        onClick={onNavigate}
        selected={active}
        sx={{
          minHeight: 40,
          borderRadius: "8px",
          px: collapsed ? 1.5 : 2,
          justifyContent: collapsed ? "center" : "flex-start",
          transition: "all 0.15s ease",
          color: active ? "var(--foreground)" : "var(--muted-foreground)",
          backgroundColor: active ? "var(--accent)" : "transparent",
          borderLeft: active ? "3px solid var(--primary)" : "3px solid transparent",
          "&:hover": {
            backgroundColor: "var(--accent)",
            color: "var(--foreground)",
          },
          "&.Mui-selected": {
            backgroundColor: "var(--accent)",
            color: "var(--foreground)",
            "&:hover": {
              backgroundColor: "var(--accent)",
            },
          },
        }}
      >
        <ListItemIcon
          sx={{
            minWidth: 0,
            mr: collapsed ? 0 : 2,
            justifyContent: "center",
            color: active ? "var(--primary)" : "inherit",
          }}
        >
          <Icon size={18} style={{ flexShrink: 0 }} />
        </ListItemIcon>
        {!collapsed && (
          <ListItemText
            primary={label}
            slotProps={{
              primary: {
                noWrap: true,
                sx: {
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 500,
                },
              },
            }}
          />
        )}
      </ListItemButton>
    </ListItem>
  );

  if (!collapsed) return itemButton;

  return (
    <Tooltip title={label} placement="right" arrow>
      {itemButton}
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
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        p: 2,
        gap: 2,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "flex-start",
          px: collapsed ? 0 : 1,
          py: 0.5,
          minHeight: 40,
        }}
      >
        <Wordmark collapsed={collapsed} />
      </Box>

      <List
        component="nav"
        aria-label="Main navigation"
        disablePadding
        sx={{ mt: 1 }}
      >
        {PRIMARY_NAV.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            collapsed={collapsed}
            onNavigate={() => shell.setSidebarOpen(false)}
          />
        ))}
      </List>

      <Box sx={{ mt: "auto" }} />

      <List
        component="nav"
        aria-label="Support navigation"
        disablePadding
      >
        {SECONDARY_NAV.map((link) => (
          <NavItem
            key={link.href}
            {...link}
            collapsed={collapsed}
            onNavigate={() => shell.setSidebarOpen(false)}
          />
        ))}
      </List>

      <Divider sx={{ borderColor: "var(--border)" }} />

      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          alignItems: collapsed ? "center" : "stretch",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            px: collapsed ? 0 : 1,
            py: 0.5,
          }}
        >
          <UserAvatar name={user.name} />
          {!collapsed && (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                variant="subtitle2"
                noWrap
                sx={{ fontWeight: 600, color: "var(--foreground)", fontSize: "0.8125rem" }}
              >
                {user.name}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{ color: "var(--muted-foreground)", display: "block" }}
              >
                {user.email}
              </Typography>
            </Box>
          )}
        </Box>

        {collapsed ? (
          <IconButton
            size="small"
            aria-label="Expand sidebar"
            onClick={() => shell.setRailCollapsed(false)}
            sx={{ color: "var(--muted-foreground)", borderRadius: "8px" }}
          >
            <PanelLeftOpen size={16} />
          </IconButton>
        ) : (
          <Button
            type="button"
            variant="text"
            size="small"
            fullWidth
            aria-label="Collapse sidebar"
            onClick={() => shell.setRailCollapsed(true)}
            startIcon={<PanelLeftClose size={16} />}
            sx={{
              justifyContent: "flex-start",
              px: 1.25,
              color: "var(--muted-foreground)",
              "&:hover": {
                backgroundColor: "var(--accent)",
                color: "var(--foreground)",
              },
            }}
          >
            Collapse sidebar
          </Button>
        )}
      </Box>
    </Box>
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
    <Drawer
      anchor="left"
      open={shell.sidebarOpen}
      onClose={() => shell.setSidebarOpen(false)}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(4px)",
          },
        },
        paper: {
          sx: {
            width: { xs: 280, sm: 300 },
            maxWidth: "85vw",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
            borderRight: "1px solid var(--border)",
            backgroundImage: "none",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.4)",
          },
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 2,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Wordmark />
        <IconButton
          size="small"
          aria-label="Close menu"
          onClick={() => shell.setSidebarOpen(false)}
          sx={{
            color: "var(--muted-foreground)",
            borderRadius: "8px",
            "&:hover": {
              backgroundColor: "var(--accent)",
              color: "var(--foreground)",
            },
          }}
        >
          <X size={18} />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, overflowY: "auto", px: 1.5, py: 2 }}>
        <List disablePadding>
          {PRIMARY_NAV.map((link) => (
            <NavItem
              key={link.href}
              {...link}
              collapsed={false}
              onNavigate={() => shell.setSidebarOpen(false)}
            />
          ))}
        </List>

        <Divider sx={{ my: 2, borderColor: "var(--border)" }} />

        <List disablePadding>
          {SECONDARY_NAV.map((link) => (
            <NavItem
              key={link.href}
              {...link}
              collapsed={false}
              onNavigate={() => shell.setSidebarOpen(false)}
            />
          ))}
        </List>
      </Box>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          borderTop: "1px solid var(--border)",
          px: 2,
          py: 2,
          backgroundColor: "var(--card)",
        }}
      >
        <UserAvatar name={user.name} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="subtitle2"
            noWrap
            sx={{ fontWeight: 600, color: "var(--foreground)" }}
          >
            {user.name}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{ color: "var(--muted-foreground)", display: "block" }}
          >
            {user.email}
          </Typography>
        </Box>
        <IconButton
          aria-label="Log out"
          onClick={async () => {
            await api.post("/sign-out", {});
            shell.setSidebarOpen(false);
            router.push("/login");
            router.refresh();
          }}
          sx={{
            color: "var(--muted-foreground)",
            borderRadius: "8px",
            "&:hover": {
              backgroundColor: "rgba(229, 72, 77, 0.1)",
              color: "var(--destructive)",
            },
          }}
        >
          <LogOut size={18} />
        </IconButton>
      </Box>
    </Drawer>
  );
}
