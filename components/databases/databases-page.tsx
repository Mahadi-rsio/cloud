"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Check,
  Copy,
  Database,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { ResourceRow } from "@/components/shared/resource-row";
import { UsageBar } from "@/components/shared/usage-bar";
import { ToneBadge } from "@/components/shared/surface-card";
import { CreateDatabaseDialog } from "./create-database-dialog";
import {
  listDatabases,
  deleteDatabase,
  type DatabaseItem,
} from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";

const FREE_PLAN_ROWS_READ_LIMIT = 1_000_000;

type SortField = "name" | "status" | "region" | "createdAt" | "usage";
type SortOrder = "asc" | "desc";
type StatusFilter = "all" | "ready" | "provisioning" | "failed";

function truncateMiddle(value: string, head = 18, tail = 12): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback below
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function getDbStatusLabel(status: DatabaseItem["status"]): string {
  if (status === "provisioning") return "Creating";
  if (status === "failed") return "Error";
  if (status === "ready") return "Ready";
  return status;
}

export function DatabasesPage() {
  const router = useRouter();
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const [databases, setDatabases] = React.useState<DatabaseItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [sortField, setSortField] = React.useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteDb, setDeleteDb] = React.useState<DatabaseItem | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [toastMessage, setToastMessage] = React.useState<string | null>(null);
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

  // "/" keyboard shortcut to focus search
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder(field === "createdAt" || field === "usage" ? "desc" : "asc");
    }
  };

  const handleCopyUrl = async (db: DatabaseItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await copyText(db.libsqlUrl);
    setCopiedId(db.id);
    setToastMessage("Connection URL copied");
    setTimeout(() => setCopiedId((curr) => (curr === db.id ? null : curr)), 1800);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDb) return;
    try {
      setIsDeleting(true);
      await deleteDatabase(deleteDb.id);
      setDatabases((prev) => prev.filter((d) => d.id !== deleteDb.id));
      setToastMessage(`Deleted "${deleteDb.name}"`);
      setDeleteDb(null);
    } catch (err) {
      setToastMessage(extractErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredAndSorted = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = databases.filter((db) => {
      if (statusFilter !== "all" && db.status !== statusFilter) return false;
      if (!q) return true;
      return (
        db.name.toLowerCase().includes(q) ||
        db.namespace.toLowerCase().includes(q) ||
        db.primaryHost.toLowerCase().includes(q)
      );
    });

    const dir = sortOrder === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortField) {
        case "name":
          return a.name.localeCompare(b.name) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "region":
          return a.region.localeCompare(b.region) * dir;
        case "usage":
          return ((a.stats?.rowsReadCount ?? 0) - (b.stats?.rowsReadCount ?? 0)) * dir;
        case "createdAt":
        default:
          return (
            (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir
          );
      }
    });
  }, [databases, searchQuery, statusFilter, sortField, sortOrder]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <PageHeader
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
            <span>Databases</span>
            {!isLoading && (
              <ToneBadge tone="primary" mono>
                {databases.length}
              </ToneBadge>
            )}
          </Box>
        }
        description="Distributed libSQL & SQLite databases with instant branching and edge replication."
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Tooltip title="Refresh databases">
              <span>
                <IconButton
                  aria-label="Refresh databases"
                  onClick={() => void loadDatabases()}
                  disabled={isLoading}
                  sx={{
                    width: 40,
                    height: 40,
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                  }}
                >
                  <RefreshCw
                    size={16}
                    style={isLoading ? { animation: "spin 1s linear infinite" } : undefined}
                  />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => setCreateOpen(true)}
              sx={{ minHeight: 40, borderRadius: "10px" }}
            >
              Create database
            </Button>
          </Stack>
        }
      />

      {/* Search & Status Filter */}
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: 1.5,
        }}
      >
        <TextField
          inputRef={searchInputRef}
          size="small"
          placeholder="Search databases by name or namespace... (Press /)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          sx={{ width: { xs: "100%", sm: 340 } }}
          slotProps={{
            input: {
              sx: { borderRadius: "10px" },
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            },
          }}
        />

        <TextField
          select
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          sx={{ width: { xs: "100%", sm: 160 } }}
          slotProps={{
            input: { sx: { borderRadius: "10px" } },
          }}
        >
          <MenuItem value="all">All statuses</MenuItem>
          <MenuItem value="ready">Ready</MenuItem>
          <MenuItem value="provisioning">Creating</MenuItem>
          <MenuItem value="failed">Error</MenuItem>
        </TextField>
      </Box>

      {/* Content */}
      {isLoading && databases.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{ borderRadius: "12px", overflow: "hidden", borderColor: "var(--border)" }}
        >
          {[1, 2, 3, 4].map((i) => (
            <Box
              key={i}
              sx={{
                px: 2,
                py: 1.75,
                display: "flex",
                alignItems: "center",
                gap: 2,
                borderBottom: i < 4 ? "1px solid var(--border)" : "none",
              }}
            >
              <Skeleton variant="rounded" width={34} height={34} />
              <Box sx={{ flex: 1 }}>
                <Skeleton width="35%" height={20} />
                <Skeleton width="55%" height={16} />
              </Box>
              <Skeleton variant="rounded" width={72} height={24} />
            </Box>
          ))}
        </Paper>
      ) : error ? (
        <ErrorState
          title="Failed to load databases"
          description={error}
          onRetry={() => void loadDatabases()}
        />
      ) : databases.length === 0 ? (
        <EmptyState
          icon={<Database size={22} />}
          title="No databases yet"
          description="Create your first libSQL database to get a connection URL, auth token, and in-app SQLite studio."
          action={
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => setCreateOpen(true)}
            >
              Create database
            </Button>
          }
        />
      ) : filteredAndSorted.length === 0 ? (
        <EmptyState
          icon={<Search size={22} />}
          title="No matching databases"
          description="No databases match your current search or status filter."
          action={
            <Button
              variant="outlined"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop Table (>=900px / md+) */}
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
              display: { xs: "none", md: "block" },
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              overflowX: "auto",
            }}
          >
            <Table size="medium" aria-label="Databases table">
              <TableHead>
                <TableRow
                  sx={{
                    "& th": {
                      fontWeight: 600,
                      fontSize: "0.75rem",
                      color: "var(--muted-foreground)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      borderBottomColor: "var(--border)",
                      py: 1.25,
                      whiteSpace: "nowrap",
                    },
                  }}
                >
                  <TableCell>
                    <TableSortLabel
                      active={sortField === "name"}
                      direction={sortField === "name" ? sortOrder : "asc"}
                      onClick={() => handleSort("name")}
                    >
                      Name
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === "status"}
                      direction={sortField === "status" ? sortOrder : "asc"}
                      onClick={() => handleSort("status")}
                    >
                      Status
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === "region"}
                      direction={sortField === "region" ? sortOrder : "asc"}
                      onClick={() => handleSort("region")}
                    >
                      Region
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === "createdAt"}
                      direction={sortField === "createdAt" ? sortOrder : "desc"}
                      onClick={() => handleSort("createdAt")}
                    >
                      Created
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ minWidth: 180 }}>
                    <TableSortLabel
                      active={sortField === "usage"}
                      direction={sortField === "usage" ? sortOrder : "desc"}
                      onClick={() => handleSort("usage")}
                    >
                      Usage
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredAndSorted.map((db) => {
                  const rowsRead = db.stats?.rowsReadCount ?? 0;
                  const readPercent = Math.min(
                    100,
                    (rowsRead / FREE_PLAN_ROWS_READ_LIMIT) * 100,
                  );
                  const isCopied = copiedId === db.id;

                  return (
                    <TableRow
                      key={db.id}
                      hover
                      onClick={() => router.push(`/databases/${db.id}`)}
                      sx={{
                        cursor: "pointer",
                        "& td": {
                          borderBottomColor: "var(--border)",
                          py: 1.375,
                        },
                        "&:last-child td": {
                          borderBottom: 0,
                        },
                      }}
                    >
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
                          <Box
                            sx={{
                              display: "flex",
                              width: 34,
                              height: 34,
                              flexShrink: 0,
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: "8px",
                              backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
                              color: "var(--primary)",
                            }}
                          >
                            <Database size={16} />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              noWrap
                              sx={{ fontWeight: 600, color: "var(--foreground)" }}
                            >
                              {db.name}
                            </Typography>
                            <Box
                              sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Typography
                                variant="caption"
                                noWrap
                                title={db.primaryHost || db.libsqlUrl}
                                sx={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "0.72rem",
                                  color: "var(--muted-foreground)",
                                }}
                              >
                                {truncateMiddle(db.primaryHost || db.libsqlUrl, 20, 12)}
                              </Typography>
                              <Tooltip title={isCopied ? "Copied" : "Copy connection URL"}>
                                <IconButton
                                  size="small"
                                  aria-label={`Copy URL for ${db.name}`}
                                  onClick={(e) => void handleCopyUrl(db, e)}
                                  sx={{
                                    width: 22,
                                    height: 22,
                                    color: isCopied ? "var(--success)" : "var(--muted-foreground)",
                                  }}
                                >
                                  {isCopied ? <Check size={12} /> : <Copy size={12} />}
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={db.status} label={getDbStatusLabel(db.status)} />
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={db.region.toUpperCase()}
                          sx={{
                            height: 22,
                            fontSize: "0.7rem",
                            fontFamily: "var(--font-mono)",
                            fontWeight: 600,
                            borderRadius: "6px",
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap", color: "var(--muted-foreground)", fontSize: "0.8125rem" }}>
                        <RelativeTime value={db.createdAt} />
                      </TableCell>
                      <TableCell>
                        <UsageBar
                          compact
                          percent={readPercent}
                          valueLabel={`${rowsRead.toLocaleString()} / 1M reads`}
                        />
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="Database actions">
                          <IconButton
                            size="small"
                            aria-label={`Actions for ${db.name}`}
                            onClick={(e) => setMenuAnchor({ el: e.currentTarget, db })}
                          >
                            <MoreHorizontal size={16} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Mobile Compact Two-Line List (<900px) */}
          <Paper
            variant="outlined"
            sx={{
              display: { xs: "block", md: "none" },
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              overflow: "hidden",
            }}
          >
            {filteredAndSorted.map((db, idx) => (
              <React.Fragment key={db.id}>
                {idx > 0 && <Divider />}
                <ResourceRow
                  onClick={() => router.push(`/databases/${db.id}`)}
                  icon={<Database size={16} />}
                  primary={
                    <>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontWeight: 600, color: "var(--foreground)", minWidth: 0 }}
                      >
                        {db.name}
                      </Typography>
                      <StatusBadge status={db.status} label={getDbStatusLabel(db.status)} />
                    </>
                  }
                  secondary={
                    <>
                      <Chip
                        size="small"
                        label={db.region.toUpperCase()}
                        sx={{
                          height: 18,
                          fontSize: "0.65rem",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 600,
                          borderRadius: "5px",
                        }}
                      />
                      <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                        <RelativeTime value={db.createdAt} />
                      </Typography>
                    </>
                  }
                  trailing={
                    <IconButton
                      size="small"
                      aria-label={`Actions for ${db.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAnchor({ el: e.currentTarget, db });
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </IconButton>
                  }
                />
              </React.Fragment>
            ))}
          </Paper>
        </>
      )}

      {/* Row Actions Menu */}
      <Menu
        anchorEl={menuAnchor?.el ?? null}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            const db = menuAnchor?.db;
            setMenuAnchor(null);
            if (db) router.push(`/databases/${db.id}`);
          }}
        >
          <ListItemIcon>
            <ExternalLink size={16} />
          </ListItemIcon>
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            const db = menuAnchor?.db;
            setMenuAnchor(null);
            if (db) void handleCopyUrl(db);
          }}
        >
          <ListItemIcon>
            <Copy size={16} />
          </ListItemIcon>
          Copy URL
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            const db = menuAnchor?.db;
            setMenuAnchor(null);
            if (db) setDeleteDb(db);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      <CreateDatabaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(created) => {
          setDatabases((prev) => [created, ...prev]);
          router.push(`/databases/${created.id}`);
        }}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteDb)}
        onOpenChange={(open) => {
          if (!open) setDeleteDb(null);
        }}
        title="Delete database"
        description={
          <>
            This permanently deletes <strong>{deleteDb?.name}</strong> and all of its data.
            This action cannot be undone.
          </>
        }
        confirmText={deleteDb?.name}
        confirmLabel="Delete database"
        isPending={isDeleting}
        onConfirm={() => void handleDeleteConfirm()}
      />

      <Snackbar
        open={Boolean(toastMessage)}
        autoHideDuration={2500}
        onClose={() => setToastMessage(null)}
        message={toastMessage}
      />
    </Box>
  );
}
