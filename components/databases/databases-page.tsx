"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Database,
  Plus,
  Search,
  RefreshCw,
  Code2,
  Trash2,
  MoreHorizontal,
  ExternalLink,
  KeyRound,
  Check,
  Copy,
  Activity,
  Table2,
  Globe,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { ActionButton, SurfaceCard, ToneBadge } from "@/components/shared/surface-card";
import { CreateDatabaseDialog } from "./create-database-dialog";
import { ConnectDatabaseDialog } from "./connect-database-dialog";
import {
  listDatabases,
  deleteDatabase,
  type DatabaseItem,
} from "@/lib/databases/client";
import { formatBytes } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";
import { useStudioIntentStore } from "@/stores/studio-intent";

const FREE_PLAN_LIMITS = {
  rowsRead: 1_000_000,
  rowsWritten: 100_000,
  storageBytes: 512 * 1024 * 1024, // 512 MB
};

function truncateMiddle(value: string, head = 22, tail = 14): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function DatabasesPage() {
  const router = useRouter();
  const [databases, setDatabases] = React.useState<DatabaseItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [connectDb, setConnectDb] = React.useState<DatabaseItem | null>(null);
  const [deleteDb, setDeleteDb] = React.useState<DatabaseItem | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const [copiedTokenId, setCopiedTokenId] = React.useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = React.useState<string | null>(null);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
  const [expandedUsage, setExpandedUsage] = React.useState<Record<string, boolean>>({});
  const [menuAnchor, setMenuAnchor] = React.useState<{
    el: HTMLElement;
    db: DatabaseItem;
  } | null>(null);

  const loadDatabases = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listDatabases();
      setDatabases(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const openStudio = (db: DatabaseItem) => {
    useStudioIntentStore.getState().setIntent({
      databaseId: db.id,
      name: db.name,
    });
    router.push("/admin/db");
  };

  const handleCopyToken = async (db: DatabaseItem) => {
    await copyText(db.defaultToken);
    setCopiedTokenId(db.id);
    setToastMessage("Auth token copied");
    setTimeout(() => setCopiedTokenId((curr) => (curr === db.id ? null : curr)), 2000);
  };

  const handleCopyUrl = async (db: DatabaseItem) => {
    await copyText(db.libsqlUrl);
    setCopiedUrlId(db.id);
    setToastMessage("Connection URL copied");
    setTimeout(() => setCopiedUrlId((curr) => (curr === db.id ? null : curr)), 2000);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDb) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteDatabase(deleteDb.id);
      setDatabases((prev) => prev.filter((d) => d.id !== deleteDb.id));
      setDeleteDb(null);
    } catch (err) {
      setDeleteError(extractErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDatabases = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return databases;
    return databases.filter(
      (db) =>
        db.name.toLowerCase().includes(q) ||
        db.namespace.toLowerCase().includes(q) ||
        db.region.toLowerCase().includes(q),
    );
  }, [databases, searchQuery]);

  const activeCountLabel = `${databases.length} active ${databases.length === 1 ? "database" : "databases"}`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <PageHeader
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
            <span>Databases</span>
            {!isLoading && (
              <ToneBadge tone="primary" mono>
                {activeCountLabel}
              </ToneBadge>
            )}
          </Box>
        }
        description="Serverless, distributed libSQL & SQLite databases with zero cold starts, replication, and instant branching."
        actions={
          <Stack direction="row" spacing={1}>
            <ActionButton
              type="button"
              variant="outlined"
              onClick={() => void loadDatabases()}
              disabled={isLoading}
              startIcon={
                <RefreshCw
                  size={16}
                  style={isLoading ? { animation: "spin 1s linear infinite" } : undefined}
                />
              }
            >
              Refresh
            </ActionButton>
            <ActionButton
              type="button"
              variant="contained"
              onClick={() => setCreateOpen(true)}
              startIcon={<Plus size={16} />}
            >
              Create Database
            </ActionButton>
          </Stack>
        }
      />

      {/* Search Bar */}
      <Box sx={{ maxWidth: { xs: "100%", sm: 380 } }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search databases by name or namespace..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          slotProps={{
            input: {
              sx: { minHeight: 44, borderRadius: "10px" },
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {/* Main Content */}
      {isLoading && databases.length === 0 ? (
        <Stack spacing={1.5}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rounded" height={112} sx={{ borderRadius: "12px" }} />
          ))}
        </Stack>
      ) : error ? (
        <ErrorState
          title="Failed to load databases"
          description={error}
          onRetry={() => void loadDatabases()}
        />
      ) : databases.length === 0 ? (
        <EmptyState
          icon={<Database size={24} />}
          title="No databases found"
          description="You haven't created any databases yet. Create your first libSQL database in seconds."
          action={
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              Create Database
            </Button>
          }
        />
      ) : filteredDatabases.length === 0 ? (
        <EmptyState
          icon={<Search size={24} />}
          title="No matching databases"
          description={`No database found matching "${searchQuery}".`}
          action={
            <Button variant="outlined" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          }
        />
      ) : (
        <Stack spacing={2}>
          {filteredDatabases.map((db) => {
            const hasCopiedToken = copiedTokenId === db.id;
            const hasCopiedUrl = copiedUrlId === db.id;
            const isUsageOpen = expandedUsage[db.id] ?? true;
            const stats = db.stats;
            const rowsRead = stats?.rowsReadCount ?? 0;
            const rowsWritten = stats?.rowsWrittenCount ?? 0;
            const storageBytes = stats?.storageBytesUsed ?? 0;
            const queryCount = stats?.queryCount ?? 0;

            const readPercent = Math.min(
              100,
              parseFloat(((rowsRead / FREE_PLAN_LIMITS.rowsRead) * 100).toFixed(1)),
            );
            const writePercent = Math.min(
              100,
              parseFloat(((rowsWritten / FREE_PLAN_LIMITS.rowsWritten) * 100).toFixed(1)),
            );
            const storagePercent = Math.min(
              100,
              parseFloat(((storageBytes / FREE_PLAN_LIMITS.storageBytes) * 100).toFixed(1)),
            );

            return (
              <SurfaceCard
                key={db.id}
                sx={{
                  p: 2,
                  borderRadius: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.75,
                }}
              >
                {/* Header Row: DB icon + name (left), Status pill + More menu (top-right) */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1,
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        width: 36,
                        height: 36,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "10px",
                        backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      <Database size={18} />
                    </Box>
                    <Typography
                      variant="subtitle1"
                      noWrap
                      sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3, minWidth: 0 }}
                    >
                      {db.name}
                    </Typography>
                  </Box>

                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
                    <StatusBadge status={db.status} />
                    <Tooltip title="Database actions">
                      <IconButton
                        aria-label={`Actions for ${db.name}`}
                        onClick={(e) => setMenuAnchor({ el: e.currentTarget, db })}
                        sx={{
                          width: 44,
                          height: 44,
                          borderRadius: "10px",
                          color: "var(--muted-foreground)",
                          "&:hover": { color: "var(--foreground)", bgcolor: "var(--accent)" },
                        }}
                      >
                        <MoreHorizontal size={18} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {/* Subline: namespace (muted mono) + region chip with Globe icon & tooltip + created time */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 1,
                    mt: -0.5,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "var(--muted-foreground)",
                    }}
                  >
                    {db.namespace}
                  </Typography>
                  <Tooltip title={`Region: ${db.region.toUpperCase()}`} arrow>
                    <span>
                      <ToneBadge
                        tone="muted"
                        mono
                        icon={<Globe size={12} />}
                      >
                        {db.region.toUpperCase()}
                      </ToneBadge>
                    </span>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
                    Created <RelativeTime value={db.createdAt} sx={{ fontWeight: 500 }} />
                  </Typography>
                </Box>

                {/* Full-width read-only monospace Connection URL with middle ellipsis & 44px copy button */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    width: "100%",
                    minHeight: 44,
                    pl: 1.5,
                    pr: 0.25,
                    borderRadius: "10px",
                    border: "1px solid var(--border)",
                    bgcolor: "var(--background)",
                  }}
                >
                  <Typography
                    component="span"
                    title={db.libsqlUrl}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: "var(--foreground)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {truncateMiddle(db.libsqlUrl)}
                  </Typography>
                  <Tooltip title={hasCopiedUrl ? "Copied" : "Copy connection URL"} arrow>
                    <IconButton
                      type="button"
                      aria-label={`Copy connection URL for ${db.name}`}
                      onClick={() => void handleCopyUrl(db)}
                      sx={{
                        width: 44,
                        height: 44,
                        flexShrink: 0,
                        borderRadius: "8px",
                        color: hasCopiedUrl ? "var(--success)" : "var(--muted-foreground)",
                        "&:hover": {
                          color: hasCopiedUrl ? "var(--success)" : "var(--foreground)",
                          bgcolor: "var(--accent)",
                        },
                      }}
                    >
                      {hasCopiedUrl ? <Check size={16} /> : <Copy size={16} />}
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* 3-Column Equal-Width Actions Grid */}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 1,
                    width: "100%",
                  }}
                >
                  <ActionButton
                    type="button"
                    variant="contained"
                    startIcon={<Table2 size={16} />}
                    onClick={() => openStudio(db)}
                  >
                    Studio
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="outlined"
                    startIcon={<Code2 size={16} />}
                    onClick={() => setConnectDb(db)}
                  >
                    Connect
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="outlined"
                    onClick={() => void handleCopyToken(db)}
                    startIcon={
                      hasCopiedToken ? (
                        <Check size={16} color="var(--success)" />
                      ) : (
                        <KeyRound size={16} />
                      )
                    }
                    title="Copy Primary Auth Token"
                  >
                    {hasCopiedToken ? "Copied" : "Token"}
                  </ActionButton>
                </Box>

                {/* Collapsible Usage & Quotas Section (no nested border-in-border) */}
                <Box sx={{ borderTop: "1px solid var(--border)", pt: 1.25 }}>
                  <ButtonBase
                    type="button"
                    onClick={() =>
                      setExpandedUsage((prev) => ({
                        ...prev,
                        [db.id]: !(prev[db.id] ?? true),
                      }))
                    }
                    aria-expanded={isUsageOpen}
                    sx={{
                      width: "100%",
                      minHeight: 44,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                      borderRadius: "8px",
                      px: 0.5,
                      textAlign: "left",
                      "&:hover": { bgcolor: "var(--action-hover, rgba(255,255,255,0.03))" },
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Activity size={14} color="var(--primary)" />
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                        Usage & quotas
                      </Typography>
                      <ToneBadge tone="primary">FREE TIER</ToneBadge>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11.5,
                          display: { xs: "none", sm: "inline" },
                        }}
                      >
                        {queryCount.toLocaleString()} queries
                      </Typography>
                      {isUsageOpen ? (
                        <ChevronUp size={16} color="var(--muted-foreground)" />
                      ) : (
                        <ChevronDown size={16} color="var(--muted-foreground)" />
                      )}
                    </Box>
                  </ButtonBase>

                  <Collapse in={isUsageOpen}>
                    <Stack spacing={1.5} sx={{ pt: 1.25, pb: 0.5 }}>
                      {/* Rows Read */}
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
                            Rows Read
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
                            {rowsRead.toLocaleString()}{" "}
                            <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                              / 1M
                            </Box>
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={Math.max(readPercent > 0 ? 2 : 0, readPercent)}
                          color={readPercent >= 100 ? "error" : readPercent > 80 ? "warning" : "primary"}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>

                      {/* Rows Written */}
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
                            Rows Written
                          </Typography>
                          <Typography
                            variant="caption"
                            color={writePercent > 80 ? "warning.main" : "text.primary"}
                            sx={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}
                          >
                            {rowsWritten.toLocaleString()}{" "}
                            <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                              / 100k
                            </Box>
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={Math.max(writePercent > 0 ? 2 : 0, writePercent)}
                          color={writePercent >= 100 ? "error" : writePercent > 80 ? "warning" : "success"}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>

                      {/* Disk Storage */}
                      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
                            Disk Storage
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
                            {formatBytes(storageBytes)}{" "}
                            <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                              / 512 MB
                            </Box>
                          </Typography>
                        </Box>
                        <LinearProgress
                          variant="determinate"
                          value={Math.max(storagePercent > 0 ? 2 : 0, storagePercent)}
                          color="info"
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    </Stack>
                  </Collapse>
                </Box>
              </SurfaceCard>
            );
          })}
        </Stack>
      )}

      {/* Row Action Menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem
          onClick={() => {
            if (menuAnchor) openStudio(menuAnchor.db);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <Table2 size={16} />
          </ListItemIcon>
          Open in Studio
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor) setConnectDb(menuAnchor.db);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <Code2 size={16} />
          </ListItemIcon>
          Connection Guide
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor) void handleCopyToken(menuAnchor.db);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <KeyRound size={16} />
          </ListItemIcon>
          Copy Auth Token
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor) void navigator.clipboard.writeText(menuAnchor.db.libsqlUrl);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <Copy size={16} />
          </ListItemIcon>
          Copy LibSQL URL
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuAnchor) void navigator.clipboard.writeText(menuAnchor.db.httpUrl);
            setMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <ExternalLink size={16} />
          </ListItemIcon>
          Copy HTTP URL
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            if (menuAnchor) {
              setDeleteError(null);
              setDeleteDb(menuAnchor.db);
            }
            setMenuAnchor(null);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "var(--destructive)" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete Database
        </MenuItem>
      </Menu>

      {/* Create Dialog */}
      <CreateDatabaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(newDb) => {
          setDatabases((prev) => [newDb, ...prev]);
        }}
        onOpenConnect={(newDb) => {
          setConnectDb(newDb);
        }}
      />

      {/* Connect Guide Dialog */}
      <ConnectDatabaseDialog
        database={connectDb}
        open={Boolean(connectDb)}
        onOpenChange={(open) => {
          if (!open) setConnectDb(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDeleteDialog
        open={Boolean(deleteDb)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDb(null);
            setDeleteError(null);
          }
        }}
        title={`Delete "${deleteDb?.name}"?`}
        description={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span>
              This will permanently delete database{" "}
              <Box component="strong" sx={{ color: "var(--foreground)" }}>
                {deleteDb?.name}
              </Box>{" "}
              and all associated tables, data, and access keys. This action cannot be undone.
            </span>
            {deleteError && <Alert severity="error">{deleteError}</Alert>}
          </Box>
        }
        confirmText={deleteDb?.name}
        confirmLabel={isDeleting ? "Deleting..." : "Delete Database"}
        isPending={isDeleting}
        onConfirm={() => void handleDeleteConfirm()}
      />

      <Snackbar
        open={Boolean(toastMessage)}
        autoHideDuration={2000}
        onClose={() => setToastMessage(null)}
        message={toastMessage}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
