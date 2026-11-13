"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Skeleton from "@mui/material/Skeleton";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Building2, MailPlus, Plus, Trash2, UserMinus, Users } from "lucide-react";
import { authClient, useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { CreateOrganizationDialog } from "@/components/shell/org-switcher";

export function OrganizationSettings({ currentUserEmail }: { currentUserEmail: string }) {
  const router = useRouter();
  const { data: organizations, isPending: orgsLoading, refetch: refetchOrgs } = useListOrganizations();
  const { data: activeOrg, isPending: activeLoading, refetch: refetchActive } = useActiveOrganization();

  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgSuccess, setOrgSuccess] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (activeOrg) {
      setOrgName(activeOrg.name);
      setOrgSlug(activeOrg.slug);
    }
  }, [activeOrg?.id, activeOrg?.name, activeOrg?.slug]);

  const orgList = organizations ?? [];
  const members = activeOrg?.members ?? [];
  const invitations = (activeOrg?.invitations ?? []).filter(
    (inv) => inv.status === "pending",
  );
  const currentMember = members.find((m) => m.user?.email === currentUserEmail);
  const isOwnerOrAdmin =
    currentMember?.role === "owner" || currentMember?.role === "admin";
  const isOwner = currentMember?.role === "owner";

  const handleUpdateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;
    setOrgError(null);
    setOrgSuccess(null);
    setSavingOrg(true);
    try {
      const res = await authClient.organization.update({
        organizationId: activeOrg.id,
        data: {
          name: orgName.trim(),
          slug: orgSlug.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""),
        },
      });
      if (res.error) {
        setOrgError(res.error.message || "Failed to update organization.");
        return;
      }
      setOrgSuccess("Organization details saved.");
      await Promise.all([refetchOrgs(), refetchActive()]);
      router.refresh();
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Failed to update organization.");
    } finally {
      setSavingOrg(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg || !inviteEmail.trim()) return;
    setInviteError(null);
    setInviteSuccess(null);
    setInviting(true);
    try {
      const res = await authClient.organization.inviteMember({
        organizationId: activeOrg.id,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (res.error) {
        setInviteError(res.error.message || "Failed to send invitation.");
        return;
      }
      setInviteSuccess(`Invitation sent to ${inviteEmail.trim()}.`);
      setInviteEmail("");
      await refetchActive();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invitation.");
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRole = async (memberId: string, role: "owner" | "admin" | "member") => {
    if (!activeOrg) return;
    await authClient.organization.updateMemberRole({
      organizationId: activeOrg.id,
      memberId,
      role,
    });
    await refetchActive();
  };

  const handleRemoveMember = async (memberIdOrEmail: string) => {
    if (!activeOrg) return;
    await authClient.organization.removeMember({
      organizationId: activeOrg.id,
      memberIdOrEmail,
    });
    await refetchActive();
  };

  const handleCancelInvitation = async (invitationId: string) => {
    await authClient.organization.cancelInvitation({ invitationId });
    await refetchActive();
  };

  const handleDeleteOrg = async () => {
    if (!activeOrg) return;
    setDeleting(true);
    try {
      const res = await authClient.organization.delete({
        organizationId: activeOrg.id,
      });
      if (res.error) {
        setOrgError(res.error.message || "Failed to delete organization.");
        setDeleteOpen(false);
        return;
      }
      setDeleteOpen(false);
      await refetchOrgs();
      const remaining = orgList.filter((o) => o.id !== activeOrg.id);
      if (remaining[0]) {
        await authClient.organization.setActive({ organizationId: remaining[0].id });
      }
      await refetchActive();
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  if (orgsLoading || activeLoading) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Skeleton variant="rounded" height={180} sx={{ borderRadius: "12px" }} />
        <Skeleton variant="rounded" height={220} sx={{ borderRadius: "12px" }} />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Card>
        <CardHeader
          title="Your Organizations"
          subheader="Switch between workspaces or create a new organization."
          action={
            <Button
              variant="contained"
              size="small"
              startIcon={<Plus size={15} />}
              onClick={() => setCreateOpen(true)}
            >
              New organization
            </Button>
          }
        />
        <CardContent sx={{ display: "flex", flexWrap: "wrap", gap: 1.25 }}>
          {orgList.length === 0 ? (
            <Typography variant="body2" sx={{ color: "var(--muted-foreground)" }}>
              No organizations yet. Create your first organization to get started.
            </Typography>
          ) : (
            orgList.map((org) => {
              const isActive = org.id === activeOrg?.id;
              return (
                <Button
                  key={org.id}
                  variant={isActive ? "contained" : "outlined"}
                  size="small"
                  startIcon={<Building2 size={15} />}
                  onClick={async () => {
                    if (isActive) return;
                    await authClient.organization.setActive({ organizationId: org.id });
                    await refetchActive();
                    router.refresh();
                  }}
                  sx={{
                    borderRadius: "10px",
                    textTransform: "none",
                    fontWeight: 600,
                  }}
                >
                  {org.name}
                </Button>
              );
            })
          )}
        </CardContent>
      </Card>

      {activeOrg && (
        <>
          <Card>
            <CardHeader
              title="Organization Profile"
              subheader={`Manage settings for ${activeOrg.name}.`}
            />
            <CardContent>
              <Box
                component="form"
                onSubmit={handleUpdateOrg}
                sx={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <TextField
                  label="Organization Name"
                  size="small"
                  fullWidth
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!isOwnerOrAdmin}
                  required
                />
                <TextField
                  label="Organization Slug"
                  size="small"
                  fullWidth
                  value={orgSlug}
                  onChange={(e) =>
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                  }
                  disabled={!isOwnerOrAdmin}
                  required
                />
                {orgError && (
                  <Alert severity="error" sx={{ borderRadius: "10px", py: 0.5 }}>
                    {orgError}
                  </Alert>
                )}
                {orgSuccess && (
                  <Alert severity="success" sx={{ borderRadius: "10px", py: 0.5 }}>
                    {orgSuccess}
                  </Alert>
                )}
                {isOwnerOrAdmin && (
                  <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                    <Button type="submit" variant="contained" disabled={savingOrg}>
                      {savingOrg ? "Saving…" : "Save changes"}
                    </Button>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>

          <Card>
            <CardHeader
              title={
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Users size={18} />
                  <span>Members ({members.length})</span>
                </Box>
              }
              subheader="People who belong to this organization."
            />
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {isOwnerOrAdmin && (
                <Box
                  component="form"
                  onSubmit={handleInvite}
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    gap: 1.5,
                    alignItems: { sm: "center" },
                  }}
                >
                  <TextField
                    label="Invite by email"
                    type="email"
                    size="small"
                    fullWidth
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                  <Select
                    size="small"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                    sx={{ minWidth: 120 }}
                  >
                    <MenuItem value="member">Member</MenuItem>
                    <MenuItem value="admin">Admin</MenuItem>
                  </Select>
                  <Button
                    type="submit"
                    variant="outlined"
                    disabled={inviting}
                    startIcon={<MailPlus size={15} />}
                    sx={{ whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    {inviting ? "Inviting…" : "Invite"}
                  </Button>
                </Box>
              )}

              {inviteError && (
                <Alert severity="error" sx={{ borderRadius: "10px", py: 0.5 }}>
                  {inviteError}
                </Alert>
              )}
              {inviteSuccess && (
                <Alert severity="success" sx={{ borderRadius: "10px", py: 0.5 }}>
                  {inviteSuccess}
                </Alert>
              )}

              <Divider sx={{ borderColor: "var(--border)" }} />

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
                {members.map((m) => {
                  const isSelf = m.user?.email === currentUserEmail;
                  return (
                    <Box
                      key={m.id}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1.5,
                        p: 1.25,
                        borderRadius: "10px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {m.user?.name || m.user?.email}
                          {isSelf && " (you)"}
                        </Typography>
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{ color: "var(--muted-foreground)", display: "block" }}
                        >
                          {m.user?.email}
                        </Typography>
                      </Box>

                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {isOwner && !isSelf ? (
                          <Select
                            size="small"
                            value={m.role}
                            onChange={(e) =>
                              void handleUpdateRole(
                                m.id,
                                e.target.value as "owner" | "admin" | "member",
                              )
                            }
                            sx={{ fontSize: "0.75rem", height: 30 }}
                          >
                            <MenuItem value="owner">Owner</MenuItem>
                            <MenuItem value="admin">Admin</MenuItem>
                            <MenuItem value="member">Member</MenuItem>
                          </Select>
                        ) : (
                          <Chip
                            label={m.role}
                            size="small"
                            variant="outlined"
                            sx={{ textTransform: "capitalize", fontWeight: 600 }}
                          />
                        )}

                        {isOwnerOrAdmin && !isSelf && (
                          <IconButton
                            size="small"
                            aria-label="Remove member"
                            onClick={() => void handleRemoveMember(m.id)}
                            sx={{ color: "var(--destructive)" }}
                          >
                            <UserMinus size={15} />
                          </IconButton>
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>

              {invitations.length > 0 && (
                <>
                  <Divider sx={{ borderColor: "var(--border)" }} />
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: "var(--muted-foreground)" }}
                  >
                    Pending invitations
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {invitations.map((inv) => (
                      <Box
                        key={inv.id}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          p: 1,
                          borderRadius: "8px",
                          backgroundColor: "var(--muted)",
                        }}
                      >
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {inv.email}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                            Role: {inv.role || "member"}
                          </Typography>
                        </Box>
                        {isOwnerOrAdmin && (
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => void handleCancelInvitation(inv.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </CardContent>
          </Card>

          {isOwner && orgList.length > 1 && (
            <Card sx={{ borderColor: "var(--destructive)" }}>
              <CardHeader
                title="Delete Organization"
                subheader="Permanently delete this organization and remove all member associations."
              />
              <CardContent>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Trash2 size={15} />}
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete {activeOrg.name}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void refetchOrgs();
          void refetchActive();
        }}
      />

      <Dialog open={deleteOpen} onClose={() => !deleting && setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete organization?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete <strong>{activeOrg?.name}</strong> and all pending invitations.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteOrg} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
