"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import { ChevronDown, CreditCard, LogOut, Settings } from "lucide-react";
import { api } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeToggleButton } from "@/components/theme/theme-toggle-button";
import { UserAvatar } from "@/components/shell/user-avatar";

export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const theme = useThemeStore();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  useEffect(() => {
    theme.init();
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  return (
    <>
      <ButtonBase
        onClick={handleClick}
        aria-controls={open ? "user-account-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.75,
          p: 0.5,
          pr: { sm: 1 },
          borderRadius: 9999,
          transition: "background-color 0.15s ease",
          "&:hover": {
            backgroundColor: "var(--accent)",
          },
        }}
      >
        <UserAvatar name={user.name} />
        <Box
          component="span"
          sx={{
            display: { xs: "none", sm: "inline-flex" },
            color: "var(--muted-foreground)",
            flexShrink: 0,
          }}
        >
          <ChevronDown size={14} />
        </Box>
      </ButtonBase>

      <Menu
        anchorEl={anchorEl}
        id="user-account-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              width: 250,
              mt: 1.5,
              borderRadius: "12px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              backgroundImage: "none",
              py: 0.75,
              "& .MuiMenuItem-root": {
                px: 2,
                py: 1,
                fontSize: "0.875rem",
                borderRadius: "8px",
                mx: 1,
                my: 0.25,
                transition: "all 0.15s ease",
                "&:hover": {
                  backgroundColor: "var(--accent)",
                },
              },
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
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

        <Divider sx={{ my: 0.75, borderColor: "var(--border)" }} />

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Typography variant="body2" sx={{ color: "var(--foreground)" }}>
            Theme
          </Typography>
          <ThemeToggleButton />
        </Box>

        <Divider sx={{ my: 0.75, borderColor: "var(--border)" }} />

        <MenuItem
          onClick={() => {
            handleClose();
            router.push("/billing");
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: "var(--muted-foreground)" }}>
            <CreditCard size={16} />
          </ListItemIcon>
          Billing
        </MenuItem>

        <MenuItem
          onClick={() => {
            handleClose();
            router.push("/settings");
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: "var(--muted-foreground)" }}>
            <Settings size={16} />
          </ListItemIcon>
          Settings
        </MenuItem>

        <Divider sx={{ my: 0.75, borderColor: "var(--border)" }} />

        <MenuItem
          onClick={async () => {
            handleClose();
            await api.post("/sign-out", {});
            router.push("/login");
            router.refresh();
          }}
          sx={{
            color: "var(--destructive) !important",
            "&:hover": {
              backgroundColor: "rgba(229, 72, 77, 0.1) !important",
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 32, color: "inherit" }}>
            <LogOut size={16} />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
