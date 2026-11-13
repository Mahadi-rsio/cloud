"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Building2,
  Check,
  ChevronsUpDown,
  Plus,
  Settings2,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  authClient,
  useActiveOrganization,
  useListOrganizations,
  useSession,
} from "@/lib/auth-client";

function slugifyOrgName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function getOrgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "O";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function CreateOrganizationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
    onClose();
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) {
      setSlug(slugifyOrgName(value));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slugifyOrgName(slug || trimmedName);
    if (!trimmedName) {
      setError("Organization name is required.");
      return;
    }
    if (!trimmedSlug) {
      setError("Organization slug must contain letters or numbers.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await authClient.organization.create({
        name: trimmedName,
        slug: trimmedSlug,
        keepCurrentActiveOrganization: false,
      });
      if (res.error) {
        setError(res.error.message || "Failed to create organization.");
        return;
      }
      if (res.data?.id) {
        await authClient.organization.setActive({
          organizationId: res.data.id,
        });
      }
      onCreated?.();
      handleClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: "14px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--card)",
            backgroundImage: "none",
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", pb: 1 }}>
        Create organization
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography variant="body2" sx={{ color: "var(--muted-foreground)" }}>
            Organizations let you separate projects, databases, and team members.
          </Typography>
          <TextField
            label="Organization Name"
            size="small"
            fullWidth
            autoFocus
            placeholder="Acme Engineering"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
          />
          <TextField
            label="URL Slug"
            size="small"
            fullWidth
            placeholder="acme-engineering"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            }}
            helperText="Lowercase letters, numbers, and hyphens only."
            required
          />
          {error && (
            <Alert severity="error" sx={{ borderRadius: "10px", fontSize: "0.8125rem", py: 0.5 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button type="button" variant="text" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function InviteMemberDialog({
  open,
  organizationId,
  organizationName,
  onClose,
  onInvited,
}: {
  open: boolean;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleClose = () => {
    if (submitting) return;
    setEmail("");
    setRole("member");
    setError(null);
    setSuccess(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authClient.organization.inviteMember({
        organizationId,
        email: email.trim(),
        role,
      });
      if (res.error) {
        setError(res.error.message || "Failed to send invitation.");
        return;
      }
      setSuccess(`Invitation sent to ${email.trim()}.`);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invitation.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: "14px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--card)",
            backgroundImage: "none",
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", pb: 1 }}>
        Add team member
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography variant="body2" sx={{ color: "var(--muted-foreground)" }}>
            Invite a teammate to <strong>{organizationName}</strong>.
          </Typography>
          <TextField
            label="Email Address"
            type="email"
            size="small"
            fullWidth
            autoFocus
            placeholder="teammate@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)", fontWeight: 600 }}>
              Role
            </Typography>
            <Select
              size="small"
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin")}
              fullWidth
            >
              <MenuItem value="member">Member — standard workspace access</MenuItem>
              <MenuItem value="admin">Admin — manage members and settings</MenuItem>
            </Select>
          </Box>
          {error && (
            <Alert severity="error" sx={{ borderRadius: "10px", fontSize: "0.8125rem", py: 0.5 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ borderRadius: "10px", fontSize: "0.8125rem", py: 0.5 }}>
              {success}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1 }}>
          <Button type="button" variant="text" onClick={handleClose} disabled={submitting}>
            Close
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitting ? "Sending…" : "Send invite"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function OrgSwitcher({
  collapsed = false,
  variant = "sidebar",
}: {
  collapsed?: boolean;
  variant?: "sidebar" | "header";
}) {
  const router = useRouter();
  const { data: sessionData } = useSession();
  const { data: organizations, isPending: orgsPending, refetch: refetchOrgs } =
    useListOrganizations();
  const { data: activeOrg, isPending: activePending, refetch: refetchActive } =
    useActiveOrganization();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const autoSelectedRef = useRef(false);

  const open = Boolean(anchorEl);
  const orgList = organizations ?? [];
  const currentOrg = activeOrg ?? orgList[0] ?? null;

  const currentMember = activeOrg?.members?.find(
    (m) => m.userId === sessionData?.user?.id || m.user?.email === sessionData?.user?.email,
  );
  const isOwner = !currentMember || currentMember.role === "owner";
  const isOwnerOrAdmin =
    !currentMember || currentMember.role === "owner" || currentMember.role === "admin";
  const canDelete = Boolean(currentOrg && isOwner && orgList.length > 1);

  useEffect(() => {
    if (
      !orgsPending &&
      !activePending &&
      !activeOrg &&
      orgList.length > 0 &&
      !autoSelectedRef.current
    ) {
      autoSelectedRef.current = true;
      void authClient.organization
        .setActive({ organizationId: orgList[0].id })
        .then(() => {
          refetchActive();
        })
        .catch(() => {
          autoSelectedRef.current = false;
        });
    }
  }, [orgsPending, activePending, activeOrg, orgList, refetchActive]);

  const handleSelectOrg = async (organizationId: string) => {
    setAnchorEl(null);
    if (organizationId === currentOrg?.id) return;
    setSwitchingId(organizationId);
    try {
      await authClient.organization.setActive({ organizationId });
      await refetchActive();
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  };

  const handleDeleteOrg = async () => {
    if (!currentOrg) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await authClient.organization.delete({
        organizationId: currentOrg.id,
      });
      if (res.error) {
        setDeleteError(res.error.message || "Failed to delete organization.");
        return;
      }
      setDeleteOpen(false);
      await refetchOrgs();
      const remaining = orgList.filter((o) => o.id !== currentOrg.id);
      if (remaining[0]) {
        await authClient.organization.setActive({ organizationId: remaining[0].id });
      }
      await refetchActive();
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete organization.");
    } finally {
      setDeleting(false);
    }
  };

  if (orgsPending && !currentOrg) {
    return (
      <Skeleton
        variant="rounded"
        height={variant === "header" ? 34 : collapsed ? 36 : 44}
        width={variant === "header" ? 160 : collapsed ? 36 : "100%"}
        sx={{ borderRadius: "10px", mx: collapsed && variant === "sidebar" ? "auto" : 0 }}
      />
    );
  }

  const trigger =
    variant === "header" ? (
      <ButtonBase
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-controls={open ? "org-switcher-menu-header" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        sx={{
          height: 34,
          px: 1.25,
          display: "inline-flex",
          alignItems: "center",
          gap: 1,
          borderRadius: "8px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--muted)",
          color: "var(--foreground)",
          maxWidth: { xs: 160, sm: 220 },
          transition: "all 0.15s ease",
          "&:hover": {
            backgroundColor: "var(--accent)",
            borderColor: "var(--ring)",
          },
        }}
      >
        <Box
          sx={{
            width: 20,
            height: 20,
            borderRadius: "5px",
            backgroundColor: "var(--primary)",
            color: "var(--primary-foreground)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.625rem",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {currentOrg ? getOrgInitials(currentOrg.name) : <Building2 size={12} />}
        </Box>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600, fontSize: "0.8125rem", lineHeight: 1 }}
        >
          {currentOrg?.name ?? "Select org"}
        </Typography>
        <ChevronsUpDown
          size={13}
          style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
        />
      </ButtonBase>
    ) : (
      <ButtonBase
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-controls={open ? "org-switcher-menu" : undefined}
        aria-haspopup="true"
        aria-expanded={open ? "true" : undefined}
        sx={{
          width: collapsed ? 38 : "100%",
          height: collapsed ? 38 : 44,
          mx: collapsed ? "auto" : 0,
          px: collapsed ? 0 : 1.25,
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 1.25,
          borderRadius: "10px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--muted)",
          color: "var(--foreground)",
          transition: "all 0.15s ease",
          "&:hover": {
            backgroundColor: "var(--accent)",
            borderColor: "var(--ring)",
          },
        }}
      >
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: "6px",
            backgroundColor: "var(--primary)",
            color: "var(--primary-foreground)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.7rem",
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {currentOrg ? getOrgInitials(currentOrg.name) : <Building2 size={14} />}
        </Box>

        {!collapsed && (
          <>
            <Box sx={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: 600, fontSize: "0.8125rem", lineHeight: 1.2 }}
              >
                {currentOrg?.name ?? "No organization"}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                sx={{
                  color: "var(--muted-foreground)",
                  fontSize: "0.7rem",
                  display: "block",
                  lineHeight: 1.2,
                }}
              >
                {currentOrg ? `@${currentOrg.slug}` : "Create workspace"}
              </Typography>
            </Box>
            <ChevronsUpDown
              size={14}
              style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
            />
          </>
        )}
      </ButtonBase>
    );

  return (
    <>
      {collapsed && variant === "sidebar" ? (
        <Tooltip title={currentOrg?.name ?? "Organizations"} placement="right" arrow>
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      <Menu
        id={variant === "header" ? "org-switcher-menu-header" : "org-switcher-menu"}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        transformOrigin={{ horizontal: "left", vertical: "top" }}
        anchorOrigin={{ horizontal: "left", vertical: "bottom" }}
        slotProps={{
          paper: {
            elevation: 4,
            sx: {
              width: 268,
              mt: 1,
              borderRadius: "12px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
              backgroundImage: "none",
              py: 0.75,
              "& .MuiMenuItem-root": {
                px: 1.5,
                py: 0.875,
                fontSize: "0.8125rem",
                borderRadius: "8px",
                mx: 0.75,
                my: 0.25,
                "&:hover": {
                  backgroundColor: "var(--accent)",
                },
              },
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 0.75 }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontSize: "0.6875rem",
            }}
          >
            Switch organization
          </Typography>
        </Box>

        {orgList.length === 0 ? (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              No organizations found.
            </Typography>
          </Box>
        ) : (
          orgList.map((org) => {
            const isSelected = org.id === currentOrg?.id;
            return (
              <MenuItem
                key={org.id}
                disabled={switchingId === org.id}
                onClick={() => handleSelectOrg(org.id)}
                sx={{ display: "flex", alignItems: "center", gap: 1.25 }}
              >
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: "6px",
                    backgroundColor: isSelected ? "var(--primary)" : "var(--muted)",
                    color: isSelected ? "var(--primary-foreground)" : "var(--foreground)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {getOrgInitials(org.name)}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: isSelected ? 600 : 500, fontSize: "0.8125rem" }}
                  >
                    {org.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      color: "var(--muted-foreground)",
                      display: "block",
                      fontSize: "0.6875rem",
                    }}
                  >
                    @{org.slug}
                  </Typography>
                </Box>
                {isSelected && (
                  <Check size={14} style={{ color: "var(--primary)", flexShrink: 0 }} />
                )}
              </MenuItem>
            );
          })
        )}

        <Divider sx={{ my: 0.75, borderColor: "var(--border)" }} />

        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            setCreateOpen(true);
          }}
        >
          <ListItemIcon sx={{ minWidth: 28, color: "var(--primary)" }}>
            <Plus size={16} />
          </ListItemIcon>
          <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.8125rem" }}>
            Create organization
          </Typography>
        </MenuItem>

        {currentOrg && isOwnerOrAdmin && (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              setInviteOpen(true);
            }}
          >
            <ListItemIcon sx={{ minWidth: 28, color: "var(--foreground)" }}>
              <UserPlus size={16} />
            </ListItemIcon>
            <Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
              Add team member
            </Typography>
          </MenuItem>
        )}

        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            router.push("/settings?tab=organization");
          }}
        >
          <ListItemIcon sx={{ minWidth: 28, color: "var(--muted-foreground)" }}>
            <Settings2 size={16} />
          </ListItemIcon>
          <Typography variant="body2" sx={{ fontSize: "0.8125rem" }}>
            Manage organization
          </Typography>
        </MenuItem>

        {canDelete && (
          <>
            <Divider sx={{ my: 0.75, borderColor: "var(--border)" }} />
            <MenuItem
              onClick={() => {
                setAnchorEl(null);
                setDeleteError(null);
                setDeleteOpen(true);
              }}
              sx={{ color: "var(--destructive)" }}
            >
              <ListItemIcon sx={{ minWidth: 28, color: "var(--destructive)" }}>
                <Trash2 size={16} />
              </ListItemIcon>
              <Typography variant="body2" sx={{ fontSize: "0.8125rem", fontWeight: 500 }}>
                Delete organization
              </Typography>
            </MenuItem>
          </>
        )}
      </Menu>

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void refetchOrgs();
          void refetchActive();
        }}
      />

      {currentOrg && (
        <InviteMemberDialog
          open={inviteOpen}
          organizationId={currentOrg.id}
          organizationName={currentOrg.name}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            void refetchActive();
          }}
        />
      )}

      <Dialog
        open={deleteOpen}
        onClose={() => !deleting && setDeleteOpen(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: "14px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--card)",
              backgroundImage: "none",
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem" }}>
          Delete organization?
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ color: "var(--muted-foreground)" }}>
            This will permanently delete <strong>{currentOrg?.name}</strong> and remove all
            members and pending invitations.
          </DialogContentText>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2, borderRadius: "10px", py: 0.5 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteOrg}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
