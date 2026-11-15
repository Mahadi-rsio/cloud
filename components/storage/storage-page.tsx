"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Copy,
  ExternalLink,
  Folder,
  HardDrive,
  Key,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { ResourceRow } from "@/components/shared/resource-row";
import { StatusBadge } from "@/components/shared/status-badge";
import { ToneBadge } from "@/components/shared/surface-card";
import { UsageBar } from "@/components/shared/usage-bar";
import { CreateNamespaceDialog } from "./create-namespace-dialog";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import {
  deleteStorageApiKey,
  deleteStorageNamespace,
  fetchApiKeys,
  fetchNamespaces,
  fetchStorageUsage,
  formatBytes,
  getApiKeyStatus,
  type StorageApiKey,
  type StorageNamespace,
  type StorageUsageResponse,
} from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

type StorageTab = "buckets" | "keys";

export type FileSortField = "name" | "size" | "uploaded";
export type FileSortOrder = "asc" | "desc";

export function sortStorageObjects<
  T extends { name?: string; key: string; size: number; uploaded: string },
>(items: T[], field: FileSortField, order: FileSortOrder): T[] {
  const dir = order === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (field === "size") return (a.size - b.size) * dir;
    if (field === "uploaded") {
      return (new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()) * dir;
    }
    const nameA = (a.name || a.key || "").toLowerCase();
    const nameB = (b.name || b.key || "").toLowerCase();
    return nameA.localeCompare(nameB) * dir;
  });
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
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export function StoragePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const rawTab = searchParams.get("tab");
  const activeTab: StorageTab = rawTab === "keys" ? "keys" : "buckets";

  const setActiveTab = React.useCallback(
    (tab: StorageTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "buckets") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [usage, setUsage] = React.useState<StorageUsageResponse | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = React.useState(true);

  const [buckets, setBuckets] = React.useState<StorageNamespace[]>([]);
  const [isLoadingBuckets, setIsLoadingBuckets] = React.useState(true);
  const [bucketsError, setBucketsError] = React.useState<string | null>(null);
  const [bucketSearch, setBucketSearch] = React.useState("");

  const [apiKeys, setApiKeys] = React.useState<StorageApiKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(false);
  const [keysError, setKeysError] = React.useState<string | null>(null);

  const [createBucketOpen, setCreateBucketOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [deleteBucketTarget, setDeleteBucketTarget] = React.useState<StorageNamespace | null>(null);
  const [isDeletingBucket, setIsDeletingBucket] = React.useState(false);
  const [deleteKeyTarget, setDeleteKeyTarget] = React.useState<StorageApiKey | null>(null);
  const [isDeletingKey, setIsDeletingKey] = React.useState(false);

  const [menuAnchor, setMenuAnchor] = React.useState<{
    el: HTMLElement;
    bucket: StorageNamespace;
  } | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setIsLoadingBuckets(true);
    setBucketsError(null);
    const [usageRes, nsRes] = await Promise.allSettled([
      fetchStorageUsage(),
      fetchNamespaces(),
    ]);

    if (usageRes.status === "fulfilled") {
      setUsage(usageRes.value);
    }
    setIsLoadingUsage(false);

    if (nsRes.status === "fulfilled") {
      setBuckets(Array.isArray(nsRes.value) ? nsRes.value : []);
    } else {
      setBucketsError(extractErrorMessage(nsRes.reason));
    }
    setIsLoadingBuckets(false);
  }, []);

  const loadKeys = React.useCallback(async () => {
    try {
      setIsLoadingKeys(true);
      setKeysError(null);
      const keys = await fetchApiKeys();
      setApiKeys(keys);
    } catch (err) {
      setKeysError(extractErrorMessage(err));
    } finally {
      setIsLoadingKeys(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData();
  }, [loadData]);

  React.useEffect(() => {
    if (activeTab === "keys") {
      void loadKeys();
    }
  }, [activeTab, loadKeys]);

  // "/" keyboard shortcut to focus search
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (activeTab === "buckets") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab]);

  const filteredBuckets = React.useMemo(() => {
    const q = bucketSearch.trim().toLowerCase();
    if (!q) return buckets;
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [buckets, bucketSearch]);

  const getBucketEndpoint = (bucketName: string) => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://cloud.rsioex.workers.dev";
    return `${origin}/api/v1/storage/namespaces/${encodeURIComponent(bucketName)}/files`;
  };

  const handleCopyEndpoint = async (bucketName: string) => {
    await copyText(getBucketEndpoint(bucketName));
    setToast("Bucket endpoint copied");
  };

  const handleDeleteBucket = async () => {
    if (!deleteBucketTarget) return;
    try {
      setIsDeletingBucket(true);
      await deleteStorageNamespace(deleteBucketTarget.name);
      setBuckets((prev) => prev.filter((b) => b.name !== deleteBucketTarget.name));
      setToast(`Deleted bucket "${deleteBucketTarget.name}"`);
      setDeleteBucketTarget(null);
      void loadData();
    } catch (err) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsDeletingBucket(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!deleteKeyTarget) return;
    try {
      setIsDeletingKey(true);
      await deleteStorageApiKey(deleteKeyTarget.id);
      setApiKeys((prev) => prev.filter((k) => k.id !== deleteKeyTarget.id));
      setToast(`Revoked API key "${deleteKeyTarget.name}"`);
      setDeleteKeyTarget(null);
    } catch (err) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsDeletingKey(false);
    }
  };

  const usedBytes = usage?.usedBytes ?? 0;
  const limitBytes = usage?.storageLimitBytes ?? 536_870_912;
  const storagePercent = usage?.storagePercent ?? 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <PageHeader
        title={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
            <span>Storage</span>
            {!isLoadingBuckets && (
              <ToneBadge tone="primary" mono>
                {buckets.length}
              </ToneBadge>
            )}
          </Box>
        }
        description="S3-compatible, zero egress fees"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Tooltip title="Refresh storage">
              <span>
                <IconButton
                  aria-label="Refresh storage"
                  onClick={() => {
                    void loadData();
                    if (activeTab === "keys") void loadKeys();
                  }}
                  disabled={isLoadingBuckets}
                  sx={{
                    width: 40,
                    height: 40,
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                  }}
                >
                  <RefreshCw
                    size={16}
                    style={isLoadingBuckets ? { animation: "spin 1s linear infinite" } : undefined}
                  />
                </IconButton>
              </span>
            </Tooltip>
            {activeTab === "buckets" ? (
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => setCreateBucketOpen(true)}
                sx={{ minHeight: 40, borderRadius: "10px" }}
              >
                Create bucket
              </Button>
            ) : (
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => setCreateKeyOpen(true)}
                sx={{ minHeight: 40, borderRadius: "10px" }}
              >
                Create API key
              </Button>
            )}
          </Stack>
        }
      />

      {/* Quota Summary Strip */}
      <Paper
        variant="outlined"
        sx={{
          px: 2.25,
          py: 1.75,
          borderRadius: "12px",
          borderColor: "var(--border)",
          backgroundColor: "var(--card)",
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              display: "flex",
              width: 36,
              height: 36,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "9px",
              backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
              color: "var(--primary)",
            }}
          >
            <HardDrive size={17} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {isLoadingUsage
                ? "Loading quota..."
                : `${formatBytes(usedBytes)} of ${formatBytes(limitBytes)} used`}
            </Typography>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              {usage ? `${usage.fileCount.toLocaleString()} total objects across ${buckets.length} buckets` : "Free tier storage quota"}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ width: { xs: "100%", sm: 280 }, flexShrink: 0 }}>
          <UsageBar
            compact
            percent={storagePercent}
            valueLabel={`${storagePercent.toFixed(1)}%`}
          />
        </Box>
      </Paper>

      {/* Top-level Tabs: Buckets | API Keys */}
      <Tabs
        value={activeTab}
        onChange={(_, v: StorageTab) => setActiveTab(v)}
        aria-label="Storage sections"
        sx={{
          borderBottom: "1px solid var(--border)",
          minHeight: 42,
          "& .MuiTab-root": {
            minHeight: 42,
            textTransform: "none",
            fontWeight: 600,
            fontSize: "0.875rem",
          },
        }}
      >
        <Tab value="buckets" label="Buckets" />
        <Tab value="keys" label="API Keys" />
      </Tabs>

      {/* Tab 1: Buckets */}
      {activeTab === "buckets" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Box sx={{ maxWidth: { xs: "100%", sm: 340 } }}>
            <TextField
              inputRef={searchInputRef}
              size="small"
              fullWidth
              placeholder="Search buckets... (Press /)"
              value={bucketSearch}
              onChange={(e) => setBucketSearch(e.target.value)}
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
          </Box>

          {isLoadingBuckets && buckets.length === 0 ? (
            <Paper
              variant="outlined"
              sx={{ borderRadius: "12px", borderColor: "var(--border)", overflow: "hidden" }}
            >
              {[1, 2, 3].map((i) => (
                <Box
                  key={i}
                  sx={{
                    px: 2,
                    py: 1.75,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    borderBottom: i < 3 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <Skeleton variant="rounded" width={34} height={34} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton width="30%" height={20} />
                    <Skeleton width="20%" height={16} />
                  </Box>
                </Box>
              ))}
            </Paper>
          ) : bucketsError ? (
            <ErrorState
              title="Failed to load buckets"
              description={bucketsError}
              onRetry={() => void loadData()}
            />
          ) : buckets.length === 0 ? (
            <EmptyState
              icon={<Folder size={22} />}
              title="No buckets yet"
              description="Create your first S3-compatible bucket to store assets, backups, and user uploads."
              action={
                <Button
                  variant="contained"
                  startIcon={<Plus size={16} />}
                  onClick={() => setCreateBucketOpen(true)}
                >
                  Create bucket
                </Button>
              }
            />
          ) : filteredBuckets.length === 0 ? (
            <EmptyState
              icon={<Search size={22} />}
              title="No matching buckets"
              description={`No buckets match "${bucketSearch}".`}
              action={
                <Button variant="outlined" onClick={() => setBucketSearch("")}>
                  Clear search
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
                }}
              >
                <Table size="medium" aria-label="Storage buckets table">
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
                        },
                      }}
                    >
                      <TableCell>Bucket name</TableCell>
                      <TableCell>Files</TableCell>
                      <TableCell>Total size</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredBuckets.map((bucket) => (
                      <TableRow
                        key={bucket.name}
                        hover
                        onClick={() => router.push(`/storage/${encodeURIComponent(bucket.name)}`)}
                        sx={{
                          cursor: "pointer",
                          "& td": { borderBottomColor: "var(--border)", py: 1.375 },
                          "&:last-child td": { borderBottom: 0 },
                        }}
                      >
                        <TableCell>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                            <Box
                              sx={{
                                display: "flex",
                                width: 34,
                                height: 34,
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: "8px",
                                backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
                                color: "var(--primary)",
                                flexShrink: 0,
                              }}
                            >
                              <Folder size={16} />
                            </Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {bucket.name}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                          {(bucket.objectCount ?? 0).toLocaleString()}
                        </TableCell>
                        <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                          {formatBytes(bucket.totalBytes ?? 0)}
                        </TableCell>
                        <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.8125rem" }}>
                          <RelativeTime value={bucket.createdAt} />
                        </TableCell>
                        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                          <Tooltip title="Bucket actions">
                            <IconButton
                              size="small"
                              aria-label={`Actions for ${bucket.name}`}
                              onClick={(e) => setMenuAnchor({ el: e.currentTarget, bucket })}
                            >
                              <MoreHorizontal size={16} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Mobile Compact Rows (<900px) */}
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
                {filteredBuckets.map((bucket, idx) => (
                  <React.Fragment key={bucket.name}>
                    {idx > 0 && <Divider />}
                    <ResourceRow
                      onClick={() => router.push(`/storage/${encodeURIComponent(bucket.name)}`)}
                      icon={<Folder size={16} />}
                      primary={
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {bucket.name}
                        </Typography>
                      }
                      secondary={
                        <>
                          <span>{(bucket.objectCount ?? 0).toLocaleString()} files</span>
                          <span>•</span>
                          <span>{formatBytes(bucket.totalBytes ?? 0)}</span>
                          <span>•</span>
                          <RelativeTime value={bucket.createdAt} />
                        </>
                      }
                      trailing={
                        <IconButton
                          size="small"
                          aria-label={`Actions for ${bucket.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuAnchor({ el: e.currentTarget, bucket });
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
        </Box>
      )}

      {/* Tab 2: API Keys */}
      {activeTab === "keys" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {isLoadingKeys && apiKeys.length === 0 ? (
            <Skeleton variant="rounded" height={180} sx={{ borderRadius: "12px" }} />
          ) : keysError ? (
            <ErrorState
              title="Failed to load API keys"
              description={keysError}
              onRetry={() => void loadKeys()}
            />
          ) : apiKeys.length === 0 ? (
            <EmptyState
              icon={<Key size={22} />}
              title="No storage API keys yet"
              description="Create an API key to upload, download, and manage objects programmatically."
              action={
                <Button
                  variant="contained"
                  startIcon={<Plus size={16} />}
                  onClick={() => setCreateKeyOpen(true)}
                >
                  Create API key
                </Button>
              }
            />
          ) : (
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{
                borderRadius: "12px",
                borderColor: "var(--border)",
                backgroundColor: "var(--card)",
              }}
            >
              <Table size="medium" aria-label="Storage API keys">
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
                      },
                    }}
                  >
                    <TableCell>Name</TableCell>
                    <TableCell>Prefix</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {apiKeys.map((k) => {
                    const status = getApiKeyStatus(k);
                    return (
                      <TableRow
                        key={k.id}
                        sx={{
                          "& td": { borderBottomColor: "var(--border)" },
                          "&:last-child td": { borderBottom: 0 },
                        }}
                      >
                        <TableCell sx={{ fontWeight: 600 }}>{k.name}</TableCell>
                        <TableCell>
                          <CopyField value={k.prefix} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={status} />
                        </TableCell>
                        <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.8125rem" }}>
                          <RelativeTime value={k.createdAt} />
                        </TableCell>
                        <TableCell align="right">
                          <Tooltip title="Revoke API key">
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={`Revoke ${k.name}`}
                              onClick={() => setDeleteKeyTarget(k)}
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* Bucket Row Actions Menu */}
      <Menu
        anchorEl={menuAnchor?.el ?? null}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            const b = menuAnchor?.bucket;
            setMenuAnchor(null);
            if (b) router.push(`/storage/${encodeURIComponent(b.name)}`);
          }}
        >
          <ListItemIcon>
            <ExternalLink size={16} />
          </ListItemIcon>
          Open
        </MenuItem>
        <MenuItem
          onClick={() => {
            const b = menuAnchor?.bucket;
            setMenuAnchor(null);
            if (b) void handleCopyEndpoint(b.name);
          }}
        >
          <ListItemIcon>
            <Copy size={16} />
          </ListItemIcon>
          Copy endpoint
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            const b = menuAnchor?.bucket;
            setMenuAnchor(null);
            if (b) setDeleteBucketTarget(b);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      <CreateNamespaceDialog
        open={createBucketOpen}
        onOpenChange={setCreateBucketOpen}
        onSuccess={(created) => {
          setBuckets((prev) => [created, ...prev]);
          router.push(`/storage/${encodeURIComponent(created.name)}`);
        }}
      />

      <CreateApiKeyDialog
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        onSuccess={() => {
          void loadKeys();
        }}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteBucketTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteBucketTarget(null);
        }}
        title="Delete bucket"
        description={
          <>
            This permanently deletes bucket <strong>{deleteBucketTarget?.name}</strong> and all
            objects inside it.
          </>
        }
        confirmText={deleteBucketTarget?.name}
        confirmLabel="Delete bucket"
        isPending={isDeletingBucket}
        onConfirm={() => void handleDeleteBucket()}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteKeyTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteKeyTarget(null);
        }}
        title="Revoke API key"
        description={
          <>
            Requests using <strong>{deleteKeyTarget?.name}</strong> will immediately fail.
          </>
        }
        confirmLabel="Revoke key"
        isPending={isDeletingKey}
        onConfirm={() => void handleDeleteKey()}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Box>
  );
}

const storageQueryClient = new QueryClient();

export function StoragePageProvider() {
  return (
    <QueryClientProvider client={storageQueryClient}>
      <StoragePage />
    </QueryClientProvider>
  );
}
