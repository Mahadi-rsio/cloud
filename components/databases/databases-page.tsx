"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
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
  ShieldCheck,
  Server,
  KeyRound,
  Check,
  Copy,
  Activity,
  Table2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
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
    try {
      await navigator.clipboard.writeText(db.defaultToken);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = db.defaultToken;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedTokenId(db.id);
    setTimeout(() => setCopiedTokenId(null), 2000);
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <PageHeader
        title="Databases"
        description="Serverless, distributed libSQL & SQLite databases with zero cold starts, replication, and instant branching."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => void loadDatabases()}
              disabled={isLoading}
              startIcon={
                <RefreshCw
                  size={14}
                  style={isLoading ? { animation: "spin 1s linear infinite" } : undefined}
                />
              }
            >
              Refresh
            </Button>
            <Button
              type="button"
              variant="contained"
              size="small"
              onClick={() => setCreateOpen(true)}
              startIcon={<Plus size={16} />}
            >
              Create Database
            </Button>
          </Stack>
        }
      />

      {/* Quick Stats bar */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
          gap: 2,
        }}
      >
        <Card sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>
          <Box
            sx={{
              display: "flex",
              width: 40,
              height: 40,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <Database size={20} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Active Databases
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {databases.length}
            </Typography>
          </Box>
        </Card>

        <Card sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>
          <Box
            sx={{
              display: "flex",
              width: 40,
              height: 40,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(59, 130, 246, 0.12)",
              color: "#3b82f6",
            }}
          >
            <Server size={20} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Engine & Protocol
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              libSQL / SQLite
            </Typography>
          </Box>
        </Card>

        <Card sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>
          <Box
            sx={{
              display: "flex",
              width: 40,
              height: 40,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(61, 214, 140, 0.12)",
              color: "#3dd68c",
            }}
          >
            <ShieldCheck size={20} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              Auth & Encryption
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Ed25519 JWT + TLS
            </Typography>
          </Box>
        </Card>
      </Box>

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
              <Card
                key={db.id}
                sx={{
                  p: 2.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  transition: "border-color 0.15s ease",
                  "&:hover": { borderColor: "text.secondary" },
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    justifyContent: "space-between",
                    alignItems: { sm: "center" },
                    gap: 2,
                  }}
                >
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
                      <Box
                        sx={{
                          display: "flex",
                          width: 32,
                          height: 32,
                          flexShrink: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "8px",
                          backgroundColor: "rgba(56, 189, 248, 0.12)",
                          color: "var(--primary)",
                        }}
                      >
                        <Database size={16} />
                      </Box>
                      <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                        {db.name}
                      </Typography>
                      <Chip
                        size="small"
                        label={db.namespace}
                        sx={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.7rem",
                          height: 22,
                          borderRadius: "6px",
                        }}
                      />
                      <StatusBadge status={db.status} />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={db.region.toUpperCase()}
                        sx={{ fontSize: "0.7rem", height: 22 }}
                      />
                    </Box>

                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: { xs: "column", sm: "row" },
                        alignItems: { sm: "center" },
                        gap: { xs: 0.75, sm: 2 },
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600, flexShrink: 0 }}>
                          URL:
                        </Typography>
                        <CopyField
                          value={db.libsqlUrl}
                          sx={{
                            borderRadius: "6px",
                            backgroundColor: "var(--muted)",
                            px: 1,
                            py: 0.25,
                            maxWidth: { xs: 300, sm: 420 },
                          }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                        Created <RelativeTime value={db.createdAt} sx={{ fontWeight: 500 }} />
                      </Typography>
                    </Box>
                  </Box>

                  {/* Actions */}
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      alignItems: "center",
                      flexShrink: 0,
                      pt: { xs: 1.5, sm: 0 },
                      borderTop: { xs: "1px solid var(--border)", sm: "none" },
                      justifyContent: { xs: "flex-end", sm: "flex-start" },
                    }}
                  >
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      startIcon={<Table2 size={14} />}
                      onClick={() => openStudio(db)}
                    >
                      Studio
                    </Button>
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      startIcon={<Code2 size={14} />}
                      onClick={() => setConnectDb(db)}
                    >
                      Connect
                    </Button>
                    <Button
                      type="button"
                      variant="text"
                      size="small"
                      onClick={() => void handleCopyToken(db)}
                      startIcon={
                        hasCopiedToken ? (
                          <Check size={14} color="#3dd68c" />
                        ) : (
                          <KeyRound size={14} />
                        )
                      }
                      title="Copy Primary Auth Token"
                    >
                      {hasCopiedToken ? "Copied" : "Token"}
                    </Button>
                    <IconButton
                      size="small"
                      aria-label="Open menu"
                      onClick={(e) => setMenuAnchor({ el: e.currentTarget, db })}
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                  </Stack>
                </Box>

                {/* Usage & Metering */}
                <Paper
                  variant="outlined"
                  sx={{
                    p: 1.75,
                    borderRadius: "10px",
                    backgroundColor: "var(--muted)",
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 1,
                      mb: 1.5,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                      <Activity size={14} color="var(--primary)" />
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                        Monthly Usage & Quotas
                      </Typography>
                      <Chip
                        size="small"
                        label="FREE TIER"
                        sx={{
                          height: 18,
                          fontSize: "10px",
                          fontWeight: 700,
                          color: "var(--primary)",
                          backgroundColor: "rgba(56, 189, 248, 0.12)",
                        }}
                      />
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
                    >
                      {queryCount.toLocaleString()} queries processed
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" },
                      gap: 2,
                    }}
                  >
                    {/* Rows Read */}
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                        <Typography variant="caption" color="text.secondary">
                          Rows Read
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                          {rowsRead.toLocaleString()}{" "}
                          <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                            / 1M ({readPercent}%)
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
                      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                        <Typography variant="caption" color="text.secondary">
                          Rows Written
                        </Typography>
                        <Typography
                          variant="caption"
                          color={writePercent > 80 ? "warning.main" : "text.primary"}
                          sx={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}
                        >
                          {rowsWritten.toLocaleString()}{" "}
                          <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                            / 100k ({writePercent}%)
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

                    {/* Storage */}
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                        <Typography variant="caption" color="text.secondary">
                          Disk Storage
                        </Typography>
                        <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                          {formatBytes(storageBytes)}{" "}
                          <Box component="span" sx={{ color: "var(--muted-foreground)", fontWeight: 400 }}>
                            / 512 MB ({storagePercent}%)
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
                  </Box>
                </Paper>
              </Card>
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
    </Box>
  );
}
