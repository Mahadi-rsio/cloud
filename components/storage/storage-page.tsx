"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
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
  HardDrive,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  Search,
  RefreshCw,
  Key,
  Plus,
  FileText,
  FileArchive,
  FileCode,
  Image as ImageIcon,
  Info,
  Folder,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { QuotaMeterBar } from "./quota-meter-bar";
import { CreateNamespaceDialog } from "./create-namespace-dialog";
import { UploadFileDialog } from "./upload-file-dialog";
import { FileDetailDialog } from "./file-detail-dialog";
import { CreateApiKeyDialog } from "./create-api-key-dialog";
import {
  fetchStorageUsage,
  fetchNamespaces,
  fetchFiles,
  deleteStorageNamespace,
  deleteStorageFile,
  downloadStorageFile,
  fetchApiKeys,
  deleteStorageApiKey,
  formatBytes,
  getApiKeyStatus,
  type StorageUsageResponse,
  type StorageNamespace,
  type StorageObject,
  type StorageApiKey,
} from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

export type FileSortField = "name" | "size" | "uploaded";
export type FileSortOrder = "asc" | "desc";

export function sortStorageObjects(
  items: StorageObject[],
  field: FileSortField,
  order: FileSortOrder,
): StorageObject[] {
  const dir = order === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (field === "size") {
      return (a.size - b.size) * dir;
    }
    if (field === "uploaded") {
      return (new Date(a.uploaded).getTime() - new Date(b.uploaded).getTime()) * dir;
    }
    const nameA = (a.name || a.key || "").toLowerCase();
    const nameB = (b.name || b.key || "").toLowerCase();
    return nameA.localeCompare(nameB) * dir;
  });
}

function getFileIcon(filename: string, contentType?: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (
    contentType?.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)
  ) {
    return <ImageIcon size={18} color="#3dd68c" style={{ flexShrink: 0 }} />;
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) {
    return <FileArchive size={18} color="#f5a524" style={{ flexShrink: 0 }} />;
  }
  if (
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "yaml", "yml", "sql", "sh"].includes(
      ext,
    )
  ) {
    return <FileCode size={18} color="#3b82f6" style={{ flexShrink: 0 }} />;
  }
  return <FileText size={18} color="var(--primary)" style={{ flexShrink: 0 }} />;
}

const PAGE_LIMIT = 100;

export function StoragePage() {
  const [activeTab, setActiveTab] = React.useState<"files" | "keys">("files");

  const [usage, setUsage] = React.useState<StorageUsageResponse | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = React.useState(true);
  const [usageError, setUsageError] = React.useState(false);

  const [namespaces, setNamespaces] = React.useState<StorageNamespace[]>([]);
  const [selectedNamespace, setSelectedNamespace] = React.useState<string>("");
  const [isLoadingNamespaces, setIsLoadingNamespaces] = React.useState(true);
  const [namespacesLoadError, setNamespacesLoadError] = React.useState<string | null>(
    null,
  );

  const [files, setFiles] = React.useState<StorageObject[]>([]);
  const [prefixes, setPrefixes] = React.useState<string[]>([]);
  const [currentPrefix, setCurrentPrefix] = React.useState<string>("");
  const [nextCursor, setNextCursor] = React.useState<string | undefined>(undefined);
  const [hasMoreFiles, setHasMoreFiles] = React.useState(false);
  const [isLoadingMoreFiles, setIsLoadingMoreFiles] = React.useState(false);
  const [fileSearch, setFileSearch] = React.useState("");
  const [sortField, setSortField] = React.useState<FileSortField>("name");
  const [sortOrder, setSortOrder] = React.useState<FileSortOrder>("asc");
  const [selectedFileKeys, setSelectedFileKeys] = React.useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);
  const [filesLoadError, setFilesLoadError] = React.useState<string | null>(null);

  const [apiKeys, setApiKeys] = React.useState<StorageApiKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(false);

  const [createStorageOpen, setCreateStorageOpen] = React.useState(false);
  const [uploadFileOpen, setUploadFileOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [detailFile, setDetailFile] = React.useState<StorageObject | null>(null);

  const [deleteFileTarget, setDeleteFileTarget] = React.useState<StorageObject | null>(
    null,
  );
  const [isDeletingFile, setIsDeletingFile] = React.useState(false);

  const [deleteStorageTarget, setDeleteStorageTarget] = React.useState<string | null>(
    null,
  );
  const [isDeletingStorage, setIsDeletingStorage] = React.useState(false);

  const [deleteKeyTarget, setDeleteKeyTarget] = React.useState<StorageApiKey | null>(
    null,
  );
  const [isDeletingKey, setIsDeletingKey] = React.useState(false);

  const [pageError, setPageError] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Request sequence counter to prevent out-of-order namespace responses from overwriting active view
  const filesRequestSeqRef = React.useRef(0);

  const loadInitialData = React.useCallback(async () => {
    setPageError(null);
    setNamespacesLoadError(null);
    setUsageError(false);
    setIsRefreshing(true);

    const [usageResult, nsResult] = await Promise.allSettled([
      fetchStorageUsage(),
      fetchNamespaces(),
    ]);

    if (usageResult.status === "fulfilled") {
      setUsage(usageResult.value);
      setUsageError(false);
    } else {
      setUsage(null);
      setUsageError(true);
    }

    if (nsResult.status === "fulfilled") {
      const safeNs = Array.isArray(nsResult.value) ? nsResult.value : [];
      setNamespaces(safeNs);
      setNamespacesLoadError(null);
      if (safeNs.length > 0) {
        setSelectedNamespace((prev) => {
          if (prev && safeNs.some((ns) => ns.name === prev)) return prev;
          return safeNs[0]!.name;
        });
      } else {
        setSelectedNamespace("");
      }
    } else {
      const errMsg = extractErrorMessage(nsResult.reason);
      setNamespacesLoadError(errMsg);
      setPageError(errMsg);
    }

    setIsLoadingUsage(false);
    setIsLoadingNamespaces(false);
    setIsRefreshing(false);
  }, []);

  React.useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const loadFilesForNamespace = React.useCallback(
    async (ns: string, prefix = "", appendCursor?: string) => {
      if (!ns) {
        setFiles([]);
        setPrefixes([]);
        setNextCursor(undefined);
        setHasMoreFiles(false);
        return;
      }

      const seq = ++filesRequestSeqRef.current;

      try {
        if (appendCursor) {
          setIsLoadingMoreFiles(true);
        } else {
          setIsLoadingFiles(true);
          setFilesLoadError(null);
          setSelectedFileKeys(new Set());
        }

        const res = await fetchFiles(ns, {
          prefix: prefix || undefined,
          limit: PAGE_LIMIT,
          cursor: appendCursor,
        });

        // Ignore stale response if user already switched namespace or prefix
        if (seq !== filesRequestSeqRef.current) return;

        setFiles((prev) => (appendCursor ? [...prev, ...res.objects] : res.objects));
        setPrefixes(res.prefixes);
        setNextCursor(res.cursor);
        setHasMoreFiles(Boolean(res.truncated && res.cursor));
      } catch (err) {
        if (seq !== filesRequestSeqRef.current) return;
        const msg = extractErrorMessage(err);
        setFilesLoadError(msg);
        setPageError(msg);
      } finally {
        if (seq === filesRequestSeqRef.current) {
          setIsLoadingFiles(false);
          setIsLoadingMoreFiles(false);
        }
      }
    },
    [],
  );

  React.useEffect(() => {
    if (selectedNamespace) {
      loadFilesForNamespace(selectedNamespace, currentPrefix);
    } else {
      setFiles([]);
      setPrefixes([]);
      setNextCursor(undefined);
      setHasMoreFiles(false);
    }
  }, [selectedNamespace, currentPrefix, loadFilesForNamespace]);

  const loadKeys = React.useCallback(async () => {
    try {
      setIsLoadingKeys(true);
      const keys = await fetchApiKeys();
      setApiKeys(keys);
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsLoadingKeys(false);
    }
  }, []);

  React.useEffect(() => {
    if (activeTab === "keys") {
      loadKeys();
    }
  }, [activeTab, loadKeys]);

  const handleStorageCreated = (created: StorageNamespace) => {
    setNamespaces((prev) => [...prev, created]);
    setCurrentPrefix("");
    setSelectedNamespace(created.name);
    fetchStorageUsage().then(setUsage).catch(() => {});
  };

  const handleConfirmDeleteStorage = async () => {
    if (!deleteStorageTarget) return;
    try {
      setIsDeletingStorage(true);
      await deleteStorageNamespace(deleteStorageTarget);
      setNamespaces((prev) => prev.filter((ns) => ns.name !== deleteStorageTarget));
      setSelectedNamespace((prev) => (prev === deleteStorageTarget ? "" : prev));
      setCurrentPrefix("");
      setDeleteStorageTarget(null);
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingStorage(false);
    }
  };

  const handleFileUploaded = async () => {
    if (selectedNamespace) {
      await loadFilesForNamespace(selectedNamespace, currentPrefix);
    }
    fetchStorageUsage().then(setUsage).catch(() => {});
  };

  const handleDownloadFile = async (file: StorageObject) => {
    const filename = file.name || (file.key ?? "").split("/").pop() || "file";
    try {
      await downloadStorageFile(selectedNamespace, file.name || file.key, filename);
    } catch (err) {
      setPageError(extractErrorMessage(err));
    }
  };

  const handleConfirmDeleteFile = async () => {
    if (!deleteFileTarget || !selectedNamespace) return;
    const targetKey = deleteFileTarget.name || deleteFileTarget.key;
    try {
      setIsDeletingFile(true);
      await deleteStorageFile(selectedNamespace, targetKey);
      setFiles((prev) => prev.filter((f) => (f.name || f.key) !== targetKey));
      setSelectedFileKeys((prev) => {
        const next = new Set(prev);
        next.delete(targetKey);
        return next;
      });
      setDeleteFileTarget(null);
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handleBulkDeleteSelected = async () => {
    if (!selectedNamespace || selectedFileKeys.size === 0) return;
    const keysToDelete = Array.from(selectedFileKeys);
    setIsBulkDeleting(true);
    setPageError(null);
    try {
      for (const fileKey of keysToDelete) {
        await deleteStorageFile(selectedNamespace, fileKey);
      }
      setFiles((prev) => prev.filter((f) => !selectedFileKeys.has(f.name || f.key)));
      setSelectedFileKeys(new Set());
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleKeyCreated = (apiKey: StorageApiKey) => {
    setApiKeys((prev) => [apiKey, ...prev]);
  };

  const handleConfirmDeleteKey = async () => {
    if (!deleteKeyTarget) return;
    try {
      setIsDeletingKey(true);
      await deleteStorageApiKey(deleteKeyTarget.id);
      setApiKeys((prev) =>
        prev.map((k) =>
          k.id === deleteKeyTarget.id
            ? { ...k, revokedAt: new Date().toISOString() }
            : k,
        ),
      );
      setDeleteKeyTarget(null);
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingKey(false);
    }
  };

  // Derive virtual subfolder prefixes and sorted/filtered files for current prefix
  const { visibleSubfolders, filteredFiles } = React.useMemo(() => {
    const folderSet = new Set<string>(prefixes);
    const matchingFiles: StorageObject[] = [];
    const q = fileSearch.trim().toLowerCase();

    for (const f of files) {
      const fullPath = f.name || f.key;
      if (currentPrefix && !fullPath.startsWith(currentPrefix)) continue;

      const relative = currentPrefix ? fullPath.slice(currentPrefix.length) : fullPath;
      // When not searching, group nested paths into clickable folders
      if (!q && relative.includes("/")) {
        const subFolder = relative.split("/")[0]!;
        folderSet.add(`${currentPrefix}${subFolder}/`);
      }

      if (
        !q ||
        fullPath.toLowerCase().includes(q) ||
        (f.httpMetadata?.contentType || "").toLowerCase().includes(q)
      ) {
        matchingFiles.push(f);
      }
    }

    return {
      visibleSubfolders: Array.from(folderSet).sort(),
      filteredFiles: sortStorageObjects(matchingFiles, sortField, sortOrder),
    };
  }, [files, prefixes, currentPrefix, fileSearch, sortField, sortOrder]);

  const breadcrumbSegments = React.useMemo(() => {
    if (!currentPrefix) return [];
    const parts = currentPrefix.replace(/\/+$/, "").split("/").filter(Boolean);
    return parts.map((label, idx) => ({
      label,
      prefix: parts.slice(0, idx + 1).join("/") + "/",
    }));
  }, [currentPrefix]);

  const toggleSort = (field: FileSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const toggleSelectFile = (key: string) => {
    setSelectedFileKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAllFiles = () => {
    if (selectedFileKeys.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedFileKeys(new Set());
    } else {
      setSelectedFileKeys(new Set(filteredFiles.map((f) => f.name || f.key)));
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        maxWidth: "80rem",
        mx: "auto",
        width: "100%",
      }}
    >
      <PageHeader
        title="Storage"
        description="High-performance S3-compatible object storage powered by Cloudflare R2 and Durable Objects with free tier metering."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => {
                loadInitialData();
                if (selectedNamespace) {
                  loadFilesForNamespace(selectedNamespace, currentPrefix);
                }
                if (activeTab === "keys") loadKeys();
              }}
              disabled={isRefreshing}
              startIcon={
                <RefreshCw
                  size={15}
                  style={
                    isRefreshing ? { animation: "spin 1s linear infinite" } : undefined
                  }
                />
              }
            >
              Refresh
            </Button>
            {activeTab === "files" ? (
              <Button
                type="button"
                variant="contained"
                size="small"
                onClick={() => setCreateStorageOpen(true)}
                startIcon={<FolderPlus size={15} />}
              >
                New Storage
              </Button>
            ) : (
              <Button
                type="button"
                variant="contained"
                size="small"
                onClick={() => setCreateKeyOpen(true)}
                startIcon={<Plus size={15} />}
              >
                Create API Key
              </Button>
            )}
          </Stack>
        }
      />

      <QuotaMeterBar
        usage={usage}
        isLoading={isLoadingUsage}
        hasError={usageError}
      />

      {pageError && (
        <Alert
          severity="error"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                loadInitialData();
                if (selectedNamespace) {
                  loadFilesForNamespace(selectedNamespace, currentPrefix);
                }
              }}
            >
              Retry
            </Button>
          }
        >
          {pageError}
        </Alert>
      )}

      <Box>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={{ borderBottom: "1px solid var(--border)" }}
        >
          <Tab
            value="files"
            icon={<HardDrive size={16} />}
            iconPosition="start"
            label="Storages & Files"
            sx={{ minHeight: 44 }}
          />
          <Tab
            value="keys"
            icon={<Key size={16} />}
            iconPosition="start"
            label="API Keys"
            sx={{ minHeight: 44 }}
          />
        </Tabs>

        {activeTab === "files" && (
          <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
            {namespacesLoadError && namespaces.length === 0 ? (
              <EmptyState
                icon={<HardDrive size={24} />}
                title="Unable to load storages"
                description={namespacesLoadError}
                action={
                  <Button
                    variant="outlined"
                    startIcon={<RefreshCw size={16} />}
                    onClick={() => loadInitialData()}
                  >
                    Retry
                  </Button>
                }
              />
            ) : namespaces.length === 0 && !isLoadingNamespaces ? (
              <EmptyState
                icon={<FolderPlus size={24} />}
                title="No storages created yet"
                description="Create your first storage bucket namespace to begin uploading, downloading, and managing files."
                action={
                  <Button
                    variant="contained"
                    startIcon={<FolderPlus size={16} />}
                    onClick={() => setCreateStorageOpen(true)}
                  >
                    Create Storage
                  </Button>
                }
              />
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* Storage Selector Bar */}
                <Paper
                  variant="outlined"
                  sx={{
                    display: "flex",
                    flexDirection: { xs: "column", sm: "row" },
                    alignItems: { xs: "stretch", sm: "center" },
                    justifyContent: "space-between",
                    gap: 1.5,
                    borderRadius: "12px",
                    p: { xs: 1.5, sm: 2 },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, minWidth: 0 }}>
                    <Box
                      sx={{
                        borderRadius: "8px",
                        backgroundColor: "rgba(56, 189, 248, 0.12)",
                        p: 1,
                        color: "var(--primary)",
                        flexShrink: 0,
                      }}
                    >
                      <Folder size={20} />
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          display: "block",
                        }}
                      >
                        Active Storage
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
                        <TextField
                          select
                          size="small"
                          value={selectedNamespace}
                          onChange={(e) => {
                            setCurrentPrefix("");
                            setSelectedNamespace(e.target.value);
                          }}
                          sx={{ minWidth: { xs: 160, sm: 220 }, maxWidth: 320, flex: 1 }}
                        >
                          {namespaces.map((ns) => (
                            <MenuItem key={ns.id || ns.name} value={ns.name}>
                              {ns.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <Tooltip title="Create new storage" arrow>
                          <IconButton
                            size="small"
                            aria-label="Create new storage"
                            onClick={() => setCreateStorageOpen(true)}
                          >
                            <Plus size={16} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Box>

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}
                  >
                    {selectedFileKeys.size > 0 && (
                      <Button
                        type="button"
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<Trash2 size={15} />}
                        onClick={handleBulkDeleteSelected}
                        disabled={isBulkDeleting}
                      >
                        {isBulkDeleting
                          ? "Deleting..."
                          : `Delete (${selectedFileKeys.size})`}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="contained"
                      size="small"
                      startIcon={<Upload size={15} />}
                      onClick={() => setUploadFileOpen(true)}
                      disabled={!selectedNamespace}
                    >
                      Upload File
                    </Button>
                    {selectedNamespace && (
                      <Tooltip title="Delete storage" arrow>
                        <IconButton
                          size="small"
                          aria-label={`Delete storage ${selectedNamespace}`}
                          onClick={() => setDeleteStorageTarget(selectedNamespace)}
                          sx={{
                            color: "var(--muted-foreground)",
                            "&:hover": { color: "var(--destructive)" },
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Paper>

                {/* Folder Breadcrumbs */}
                {breadcrumbSegments.length > 0 && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 0.5,
                      px: 0.5,
                    }}
                  >
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setCurrentPrefix("")}
                      sx={{ minWidth: 0, px: 1, fontSize: "0.75rem" }}
                    >
                      {selectedNamespace}
                    </Button>
                    {breadcrumbSegments.map((seg) => (
                      <React.Fragment key={seg.prefix}>
                        <ChevronRight size={14} color="var(--muted-foreground)" />
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setCurrentPrefix(seg.prefix)}
                          sx={{
                            minWidth: 0,
                            px: 1,
                            fontSize: "0.75rem",
                            fontWeight: seg.prefix === currentPrefix ? 700 : 500,
                          }}
                        >
                          {seg.label}
                        </Button>
                      </React.Fragment>
                    ))}
                  </Box>
                )}

                {/* Files Explorer Bar */}
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
                    size="small"
                    placeholder="Search files by path or MIME type..."
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    sx={{ maxWidth: { sm: 380 }, flex: 1 }}
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
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}
                  >
                    {filteredFiles.length} {filteredFiles.length === 1 ? "file" : "files"}
                    {files.length > 0 && (
                      <> • {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</>
                    )}
                  </Typography>
                </Box>

                {/* Subfolder chips */}
                {visibleSubfolders.length > 0 && !fileSearch.trim() && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
                    {visibleSubfolders.map((folderPrefix) => {
                      const label = folderPrefix
                        .slice(currentPrefix.length)
                        .replace(/\/$/, "");
                      return (
                        <Chip
                          key={folderPrefix}
                          icon={<Folder size={14} />}
                          label={`${label}/`}
                          clickable
                          onClick={() => setCurrentPrefix(folderPrefix)}
                          variant="outlined"
                          sx={{ borderRadius: "8px", fontWeight: 500 }}
                        />
                      );
                    })}
                  </Box>
                )}

                {/* Files Table */}
                {isLoadingFiles ? (
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      py: 6,
                      gap: 1,
                    }}
                  >
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary">
                      Loading files from R2...
                    </Typography>
                  </Box>
                ) : filesLoadError && files.length === 0 ? (
                  <EmptyState
                    icon={<HardDrive size={24} />}
                    title="Failed to load files"
                    description={filesLoadError}
                    action={
                      <Button
                        variant="outlined"
                        startIcon={<RefreshCw size={16} />}
                        onClick={() =>
                          loadFilesForNamespace(selectedNamespace, currentPrefix)
                        }
                      >
                        Retry
                      </Button>
                    }
                  />
                ) : filteredFiles.length === 0 ? (
                  files.length === 0 ? (
                    <EmptyState
                      icon={<Upload size={24} />}
                      title="No files in this storage"
                      description={`Storage "${selectedNamespace}" is currently empty. Upload files to get started.`}
                      action={
                        <Button
                          variant="contained"
                          startIcon={<Upload size={16} />}
                          onClick={() => setUploadFileOpen(true)}
                        >
                          Upload File
                        </Button>
                      }
                    />
                  ) : (
                    <Paper
                      variant="outlined"
                      sx={{
                        borderStyle: "dashed",
                        borderRadius: "12px",
                        p: 4,
                        textAlign: "center",
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No files match your search query.
                      </Typography>
                    </Paper>
                  )
                ) : (
                  <>
                    <TableContainer
                      component={Paper}
                      variant="outlined"
                      sx={{ borderRadius: "12px", overflowX: "auto" }}
                    >
                      <Table size="small" sx={{ minWidth: 560 }}>
                        <TableHead>
                          <TableRow sx={{ backgroundColor: "var(--muted)" }}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                checked={
                                  filteredFiles.length > 0 &&
                                  selectedFileKeys.size === filteredFiles.length
                                }
                                indeterminate={
                                  selectedFileKeys.size > 0 &&
                                  selectedFileKeys.size < filteredFiles.length
                                }
                                onChange={toggleSelectAllFiles}
                                slotProps={{ input: { "aria-label": "Select all files" } }}
                              />
                            </TableCell>
                            <TableCell
                              onClick={() => toggleSort("name")}
                              sx={{
                                fontWeight: 600,
                                fontSize: "0.75rem",
                                textTransform: "uppercase",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                            >
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                Name
                                <ArrowUpDown size={12} />
                              </Box>
                            </TableCell>
                            <TableCell
                              onClick={() => toggleSort("size")}
                              sx={{
                                fontWeight: 600,
                                fontSize: "0.75rem",
                                textTransform: "uppercase",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                            >
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                Size
                                <ArrowUpDown size={12} />
                              </Box>
                            </TableCell>
                            <TableCell
                              onClick={() => toggleSort("uploaded")}
                              sx={{
                                fontWeight: 600,
                                fontSize: "0.75rem",
                                textTransform: "uppercase",
                                cursor: "pointer",
                                userSelect: "none",
                              }}
                            >
                              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                                Last Modified
                                <ArrowUpDown size={12} />
                              </Box>
                            </TableCell>
                            <TableCell
                              sx={{
                                fontWeight: 600,
                                fontSize: "0.75rem",
                                textTransform: "uppercase",
                              }}
                            >
                              ETag
                            </TableCell>
                            <TableCell
                              align="right"
                              sx={{
                                fontWeight: 600,
                                fontSize: "0.75rem",
                                textTransform: "uppercase",
                              }}
                            >
                              Actions
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredFiles.map((file) => {
                            const fileKey = file.name || file.key;
                            const filename = fileKey.split("/").pop() || "file";
                            const isSelected = selectedFileKeys.has(fileKey);
                            return (
                              <TableRow
                                key={fileKey}
                                hover
                                selected={isSelected}
                                sx={{ cursor: "pointer" }}
                                onClick={() => setDetailFile(file)}
                              >
                                <TableCell
                                  padding="checkbox"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={isSelected}
                                    onChange={() => toggleSelectFile(fileKey)}
                                    slotProps={{ input: { "aria-label": `Select ${fileKey}` } }}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                    {getFileIcon(filename, file.httpMetadata?.contentType)}
                                    <Box sx={{ minWidth: 0 }}>
                                      <Typography
                                        variant="body2"
                                        noWrap
                                        sx={{ fontWeight: 500, maxWidth: { xs: 200, sm: 360 } }}
                                      >
                                        {fileKey}
                                      </Typography>
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ fontSize: "11px" }}
                                      >
                                        {file.httpMetadata?.contentType ||
                                          "application/octet-stream"}
                                      </Typography>
                                    </Box>
                                  </Box>
                                </TableCell>
                                <TableCell
                                  sx={{
                                    color: "var(--muted-foreground)",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {formatBytes(file.size)}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    color: "var(--muted-foreground)",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  <RelativeTime date={file.uploaded} />
                                </TableCell>
                                <TableCell
                                  sx={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: "0.75rem",
                                    color: "var(--muted-foreground)",
                                    maxWidth: 140,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {file.etag}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{ whiteSpace: "nowrap" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Tooltip title="Download" arrow>
                                    <IconButton
                                      size="small"
                                      aria-label={`Download ${fileKey}`}
                                      onClick={() => handleDownloadFile(file)}
                                    >
                                      <Download size={16} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="View details" arrow>
                                    <IconButton
                                      size="small"
                                      aria-label={`Details for ${fileKey}`}
                                      onClick={() => setDetailFile(file)}
                                    >
                                      <Info size={16} />
                                    </IconButton>
                                  </Tooltip>
                                  <Tooltip title="Delete" arrow>
                                    <IconButton
                                      size="small"
                                      aria-label={`Delete ${fileKey}`}
                                      onClick={() => setDeleteFileTarget(file)}
                                      sx={{ "&:hover": { color: "var(--destructive)" } }}
                                    >
                                      <Trash2 size={16} />
                                    </IconButton>
                                  </Tooltip>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </TableContainer>

                    {hasMoreFiles && nextCursor && (
                      <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          disabled={isLoadingMoreFiles}
                          onClick={() =>
                            loadFilesForNamespace(
                              selectedNamespace,
                              currentPrefix,
                              nextCursor,
                            )
                          }
                        >
                          {isLoadingMoreFiles ? "Loading more..." : "Load More Files"}
                        </Button>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}
          </Box>
        )}

        {activeTab === "keys" && (
          <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 3 }}>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { sm: "center" },
                justifyContent: "space-between",
                gap: 1.5,
              }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Storage API Keys
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Keys authenticate REST API, cURL scripts, and S3-compatible SDKs
                  against your storage buckets.
                </Typography>
              </Box>
              <Button
                type="button"
                variant="contained"
                size="small"
                startIcon={<Plus size={15} />}
                onClick={() => setCreateKeyOpen(true)}
                sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}
              >
                Create API Key
              </Button>
            </Box>

            {isLoadingKeys ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  py: 6,
                  gap: 1,
                }}
              >
                <CircularProgress size={24} />
                <Typography variant="body2" color="text.secondary">
                  Loading API keys...
                </Typography>
              </Box>
            ) : apiKeys.length === 0 ? (
              <EmptyState
                icon={<Key size={24} />}
                title="No API keys generated"
                description="Create an API key to securely upload, download, and manage storage programmatically."
                action={
                  <Button
                    variant="contained"
                    startIcon={<Plus size={16} />}
                    onClick={() => setCreateKeyOpen(true)}
                  >
                    Create API Key
                  </Button>
                }
              />
            ) : (
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ borderRadius: "12px", overflowX: "auto" }}
              >
                <Table size="small" sx={{ minWidth: 680 }}>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "var(--muted)" }}>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Key Name
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Prefix / Key ID
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Status
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Permissions
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Last Used
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Created
                      </TableCell>
                      <TableCell
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Expires
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                        }}
                      >
                        Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {apiKeys.map((key) => {
                      const status = getApiKeyStatus(key);
                      const scopeItems = String(key.scopes || "")
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      return (
                        <TableRow key={key.id} hover>
                          <TableCell sx={{ fontWeight: 500 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Key size={15} color="var(--muted-foreground)" />
                              <span>{key.name}</span>
                            </Box>
                          </TableCell>
                          <TableCell
                            sx={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                          >
                            <CopyField value={key.prefix || key.id} />
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={
                                status === "active"
                                  ? "Active"
                                  : status === "revoked"
                                    ? "Revoked"
                                    : "Expired"
                              }
                              color={
                                status === "active"
                                  ? "success"
                                  : status === "revoked"
                                    ? "error"
                                    : "warning"
                              }
                              sx={{ height: 22, fontSize: "0.7rem", fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                              {scopeItems.map((scope) => (
                                <Chip
                                  key={scope}
                                  size="small"
                                  label={scope}
                                  sx={{
                                    height: 20,
                                    fontSize: "0.7rem",
                                    borderRadius: "6px",
                                  }}
                                />
                              ))}
                            </Box>
                          </TableCell>
                          <TableCell
                            sx={{
                              color: "var(--muted-foreground)",
                              fontSize: "0.75rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {key.lastUsedAt ? (
                              <RelativeTime date={key.lastUsedAt} />
                            ) : (
                              "Never"
                            )}
                          </TableCell>
                          <TableCell
                            sx={{
                              color: "var(--muted-foreground)",
                              fontSize: "0.75rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <RelativeTime date={key.createdAt} />
                          </TableCell>
                          <TableCell
                            sx={{
                              color: "var(--muted-foreground)",
                              fontSize: "0.75rem",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {key.expiresAt ? (
                              <RelativeTime date={key.expiresAt} />
                            ) : (
                              "Never"
                            )}
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                            {status === "active" && (
                              <Tooltip title="Revoke API key" arrow>
                                <IconButton
                                  size="small"
                                  aria-label={`Revoke API key ${key.name}`}
                                  onClick={() => setDeleteKeyTarget(key)}
                                  sx={{
                                    color: "var(--muted-foreground)",
                                    "&:hover": { color: "var(--destructive)" },
                                  }}
                                >
                                  <Trash2 size={16} />
                                </IconButton>
                              </Tooltip>
                            )}
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
      </Box>

      {/* Dialogs */}
      <CreateNamespaceDialog
        open={createStorageOpen}
        onOpenChange={setCreateStorageOpen}
        onSuccess={handleStorageCreated}
      />

      {selectedNamespace && (
        <UploadFileDialog
          namespace={selectedNamespace}
          currentPrefix={currentPrefix}
          open={uploadFileOpen}
          onOpenChange={setUploadFileOpen}
          onSuccess={handleFileUploaded}
        />
      )}

      <FileDetailDialog
        file={detailFile}
        namespace={selectedNamespace}
        open={Boolean(detailFile)}
        onOpenChange={(open) => {
          if (!open) setDetailFile(null);
        }}
        onDelete={(file) => setDeleteFileTarget(file)}
      />

      <CreateApiKeyDialog
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        onSuccess={handleKeyCreated}
        namespaces={namespaces}
      />

      {deleteFileTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteFileTarget(null);
          }}
          title={`Delete ${deleteFileTarget.name || deleteFileTarget.key}?`}
          description={
            <>
              This will permanently delete this file from storage bucket{" "}
              <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                {selectedNamespace}
              </Box>
              . This action cannot be undone.
            </>
          }
          isPending={isDeletingFile}
          onConfirm={handleConfirmDeleteFile}
        />
      )}

      {deleteStorageTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteStorageTarget(null);
          }}
          title={`Delete storage "${deleteStorageTarget}"?`}
          description={
            <>
              This will permanently delete storage bucket{" "}
              <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                {deleteStorageTarget}
              </Box>{" "}
              and all files stored within it.
            </>
          }
          confirmText={deleteStorageTarget}
          isPending={isDeletingStorage}
          onConfirm={handleConfirmDeleteStorage}
        />
      )}

      {deleteKeyTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteKeyTarget(null);
          }}
          title={`Revoke API Key "${deleteKeyTarget.name}"?`}
          description="Any application or script using this API key will immediately lose access to your storage buckets. This cannot be undone."
          isPending={isDeletingKey}
          onConfirm={handleConfirmDeleteKey}
        />
      )}
    </Box>
  );
}

const queryClient = new QueryClient();

export function StoragePageProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <StoragePage />
    </QueryClientProvider>
  );
}
