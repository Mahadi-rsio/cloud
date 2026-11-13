"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  AppWindow,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  listApplications,
  type Application,
  type ApplicationStatus,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { appUrl } from "@/lib/site";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { formatGuestSize, regionName } from "@/components/apps/format";

const LIST_PAGE_SIZE = 20;

export function AppsPage() {
  const [items, setItems] = useState<Application[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("");
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{
    el: HTMLElement;
    app: Application;
  } | null>(null);

  const load = async (pageCursor: string | null, replace: boolean) => {
    try {
      setError(null);
      if (replace) setIsLoading(true);
      const page = await listApplications({
        cursor: pageCursor,
        limit: LIST_PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      if (replace) {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } else {
        setItems((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      if (replace) setIsLoading(false);
    }
  };

  useEffect(() => {
    void load(null, true);
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (app) =>
        app.name.toLowerCase().includes(query) ||
        app.slug.toLowerCase().includes(query)
    );
  }, [items, search]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { deleteApplication } = await import("@/lib/applications");
      await deleteApplication(deleteTarget.id);
      setDeleteTarget(null);
      void load(null, true);
    } catch (deleteError) {
      setError(extractErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Box
      sx={{
        mx: "auto",
        display: "flex",
        width: "100%",
        maxWidth: "64rem",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <PageHeader
        title="Apps"
        description="Deploy backend apps from a Docker image or a GitHub repo. Each app gets a public URL."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<RefreshCw size={14} />}
              onClick={() => void load(null, true)}
            >
              Refresh
            </Button>
            <Button
              component={Link}
              href="/apps/new"
              variant="contained"
              size="small"
              startIcon={<Plus size={16} />}
            >
              New app
            </Button>
          </Stack>
        }
      />

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "center" },
          gap: 1.5,
        }}
      >
        <TextField
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search apps…"
          aria-label="Search apps"
          sx={{ width: { xs: "100%", sm: 280 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: { xs: "space-between", sm: "flex-start" },
            gap: 1.5,
          }}
        >
          <TextField
            select
            size="small"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as ApplicationStatus | "")
            }
            sx={{ width: { xs: "100%", sm: 176 } }}
            slotProps={{ select: { displayEmpty: true } }}
          >
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="provisioning">Provisioning</MenuItem>
            <MenuItem value="running">Running</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="failed">Failed</MenuItem>
          </TextField>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flexShrink: 0 }}
            aria-live="polite"
          >
            {isLoading && items.length === 0
              ? "Loading…"
              : `${filtered.length} app${filtered.length === 1 ? "" : "s"}`}
          </Typography>
        </Box>
      </Box>

      {isLoading && items.length === 0 ? (
        <Stack spacing={1}>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={64} />
          ))}
        </Stack>
      ) : error && items.length === 0 ? (
        <ErrorState
          description={error}
          onRetry={() => void load(null, true)}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<AppWindow size={20} />}
          title={items.length === 0 ? "No apps yet" : "No matching apps"}
          description={
            items.length === 0
              ? "Create your first app to get a public URL."
              : "Try a different search or filter."
          }
          action={
            items.length === 0 ? (
              <Button
                component={Link}
                href="/apps/new"
                variant="contained"
                startIcon={<Plus size={16} />}
              >
                New app
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ display: { xs: "none", md: "block" }, borderRadius: "12px" }}
          >
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "var(--muted)" }}>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                    Name
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                    URL
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                    Region
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                    Size
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                    Deployed
                  </TableCell>
                  <TableCell align="right" sx={{ width: 48 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((app) => (
                  <TableRow key={app.id} hover>
                    <TableCell>
                      <Box
                        component={Link}
                        href={`/apps/${app.id}`}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1.25,
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                            {app.name}
                          </Typography>
                          <Typography
                            variant="caption"
                            noWrap
                            color="text.secondary"
                            sx={{ fontFamily: "var(--font-mono)", display: "block" }}
                          >
                            {app.slug}
                          </Typography>
                        </Box>
                        <StatusBadge status={app.status} />
                      </Box>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 224 }}>
                      <CopyField value={appUrl(app.slug)} />
                    </TableCell>
                    <TableCell sx={{ color: "var(--muted-foreground)" }}>
                      {regionName(app.region)}
                    </TableCell>
                    <TableCell sx={{ color: "var(--muted-foreground)" }}>
                      {formatGuestSize(app.runtime?.guest)}
                    </TableCell>
                    <TableCell sx={{ color: "var(--muted-foreground)" }}>
                      <RelativeTime value={app.lastOperationAt ?? app.updatedAt} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label={`Actions for ${app.name}`}
                        onClick={(e) => setMenuAnchor({ el: e.currentTarget, app })}
                      >
                        <MoreHorizontal size={16} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Mobile stacked cards */}
          <Stack spacing={1} sx={{ display: { xs: "flex", md: "none" } }}>
            {filtered.map((app) => (
              <Card key={app.id} sx={{ p: 2 }}>
                <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}>
                  <Box
                    component={Link}
                    href={`/apps/${app.id}`}
                    sx={{ minWidth: 0, flex: 1, textDecoration: "none", color: "inherit" }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                        {app.name}
                      </Typography>
                      <StatusBadge status={app.status} />
                    </Box>
                    <Typography
                      variant="caption"
                      noWrap
                      color="text.secondary"
                      sx={{ fontFamily: "var(--font-mono)", display: "block", mt: 0.25 }}
                    >
                      {app.slug}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Actions for ${app.name}`}
                    onClick={(e) => setMenuAnchor({ el: e.currentTarget, app })}
                  >
                    <MoreHorizontal size={16} />
                  </IconButton>
                </Box>

                <Box sx={{ mt: 1.5, pt: 1.5, borderTop: "1px solid var(--border)" }}>
                  <CopyField value={appUrl(app.slug)} />
                </Box>

                <Box
                  sx={{
                    mt: 1.5,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 1.5,
                  }}
                >
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      Region
                    </Typography>
                    <Typography variant="body2">{regionName(app.region)}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      Size
                    </Typography>
                    <Typography variant="body2">
                      {formatGuestSize(app.runtime?.guest)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      Deployed
                    </Typography>
                    <Typography variant="body2">
                      <RelativeTime value={app.lastOperationAt ?? app.updatedAt} />
                    </Typography>
                  </Box>
                </Box>
              </Card>
            ))}
          </Stack>
        </>
      )}

      {nextCursor && (
        <Box sx={{ display: "flex", justifyContent: "center" }}>
          <Button
            type="button"
            variant="outlined"
            onClick={() => void load(nextCursor, false)}
          >
            Load more
          </Button>
        </Box>
      )}

      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem
          component="a"
          href={menuAnchor ? appUrl(menuAnchor.app.slug) : "#"}
          target="_blank"
          rel="noreferrer"
          onClick={() => setMenuAnchor(null)}
        >
          <ListItemIcon>
            <ExternalLink size={16} />
          </ListItemIcon>
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor) setDeleteTarget(menuAnchor.app);
            setMenuAnchor(null);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "var(--destructive)" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      {deleteTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={`Delete ${deleteTarget.name}?`}
          description="This permanently deletes the app and its machine. The public URL will stop working immediately. This cannot be undone."
          confirmText={deleteTarget.name}
          isPending={isDeleting}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </Box>
  );
}

const queryClient = new QueryClient();

export function AppsPageProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppsPage />
    </QueryClientProvider>
  );
}
