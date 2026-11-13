"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
  type StorageUsageResponse,
  type StorageNamespace,
  type StorageObject,
  type StorageApiKey,
} from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

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
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "yaml", "yml", "sql", "sh"].includes(ext)
  ) {
    return <FileCode size={18} color="#3b82f6" style={{ flexShrink: 0 }} />;
  }
  return <FileText size={18} color="var(--primary)" style={{ flexShrink: 0 }} />;
}

export function StoragePage() {
  const [activeTab, setActiveTab] = React.useState<"files" | "keys">("files");

  const [usage, setUsage] = React.useState<StorageUsageResponse | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = React.useState(true);

  const [namespaces, setNamespaces] = React.useState<StorageNamespace[]>([]);
  const [selectedNamespace, setSelectedNamespace] = React.useState<string>("");
  const [isLoadingNamespaces, setIsLoadingNamespaces] = React.useState(true);

  const [files, setFiles] = React.useState<StorageObject[]>([]);
  const [fileSearch, setFileSearch] = React.useState("");
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);

  const [apiKeys, setApiKeys] = React.useState<StorageApiKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(false);

  const [createStorageOpen, setCreateStorageOpen] = React.useState(false);
  const [uploadFileOpen, setUploadFileOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [detailFile, setDetailFile] = React.useState<StorageObject | null>(null);

  const [deleteFileTarget, setDeleteFileTarget] = React.useState<StorageObject | null>(null);
  const [isDeletingFile, setIsDeletingFile] = React.useState(false);

  const [deleteStorageTarget, setDeleteStorageTarget] = React.useState<string | null>(null);
  const [isDeletingStorage, setIsDeletingStorage] = React.useState(false);

  const [deleteKeyTarget, setDeleteKeyTarget] = React.useState<StorageApiKey | null>(null);
  const [isDeletingKey, setIsDeletingKey] = React.useState(false);

  const [pageError, setPageError] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const loadInitialData = React.useCallback(async () => {
    try {
      setPageError(null);
      setIsRefreshing(true);
      const [usageData, nsData] = await Promise.all([
        fetchStorageUsage().catch(() => null),
        fetchNamespaces().catch(() => []),
      ]);

      setUsage(usageData);
      const safeNs = Array.isArray(nsData) ? nsData : [];
      setNamespaces(safeNs);

      if (safeNs.length > 0) {
        setSelectedNamespace((prev) => {
          if (prev && safeNs.some((ns) => ns.name === prev)) return prev;
          return safeNs[0].name;
        });
      } else {
        setSelectedNamespace("");
      }
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsLoadingUsage(false);
      setIsLoadingNamespaces(false);
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const loadFilesForNamespace = React.useCallback(async (ns: string) => {
    if (!ns) {
      setFiles([]);
      return;
    }
    try {
      setIsLoadingFiles(true);
      const res = await fetchFiles(ns, { limit: 500 });
      setFiles(res.objects);
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsLoadingFiles(false);
    }
  }, []);

  React.useEffect(() => {
    if (selectedNamespace) {
      loadFilesForNamespace(selectedNamespace);
    } else {
      setFiles([]);
    }
  }, [selectedNamespace, loadFilesForNamespace]);

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
      await loadFilesForNamespace(selectedNamespace);
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
    try {
      setIsDeletingFile(true);
      await deleteStorageFile(selectedNamespace, deleteFileTarget.name || deleteFileTarget.key);
      setFiles((prev) =>
        prev.filter((f) => (f.name || f.key) !== (deleteFileTarget.name || deleteFileTarget.key))
      );
      setDeleteFileTarget(null);
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingFile(false);
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
      setApiKeys((prev) => prev.filter((k) => k.id !== deleteKeyTarget.id));
      setDeleteKeyTarget(null);
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingKey(false);
    }
  };

  const filteredFiles = React.useMemo(() => {
    if (!fileSearch.trim()) return files;
    const q = fileSearch.toLowerCase();
    return files.filter(
      (f) =>
        (f.name || f.key).toLowerCase().includes(q) ||
        (f.httpMetadata?.contentType || "").toLowerCase().includes(q)
    );
  }, [files, fileSearch]);

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
                if (selectedNamespace) loadFilesForNamespace(selectedNamespace);
                if (activeTab === "keys") loadKeys();
              }}
              disabled={isRefreshing}
              startIcon={
                <RefreshCw
                  size={15}
                  style={isRefreshing ? { animation: "spin 1s linear infinite" } : undefined}
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

      <QuotaMeterBar usage={usage} isLoading={isLoadingUsage} />

      {pageError && <Alert severity="error">{pageError}</Alert>}

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
          <Box sx={{ mt: 3, display: "flex", flexDirection: "column", gap: 3 }}>
            {namespaces.length === 0 && !isLoadingNamespaces ? (
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
                        sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block" }}
                      >
                        Active Storage
                      </Typography>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.25 }}>
                        <TextField
                          select
                          size="small"
                          value={selectedNamespace}
                          onChange={(e) => setSelectedNamespace(e.target.value)}
                          sx={{ minWidth: 200, maxWidth: 320 }}
                        >
                          {namespaces.map((ns) => (
                            <MenuItem key={ns.id || ns.name} value={ns.name}>
                              {ns.name}
                            </MenuItem>
                          ))}
                        </TextField>
                        <Tooltip title="Create new storage" arrow>
                          <IconButton size="small" onClick={() => setCreateStorageOpen(true)}>
                            <Plus size={16} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}>
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
                    placeholder="Search files in this storage..."
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

                {/* Files Table */}
                {isLoadingFiles ? (
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 6, gap: 1 }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary">
                      Loading files from R2...
                    </Typography>
                  </Box>
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
                  <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: "12px" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: "var(--muted)" }}>
                          <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                            Name
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                            Size
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                            Last Modified
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                            ETag
                          </TableCell>
                          <TableCell
                            align="right"
                            sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}
                          >
                            Actions
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredFiles.map((file) => {
                          const filename = file.name || (file.key ?? "").split("/").pop() || "file";
                          return (
                            <TableRow
                              key={file.key || file.name}
                              hover
                              sx={{ cursor: "pointer" }}
                              onClick={() => setDetailFile(file)}
                            >
                              <TableCell>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                  {getFileIcon(filename, file.httpMetadata?.contentType)}
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" noWrap sx={{ fontWeight: 500, maxWidth: 360 }}>
                                      {file.name || file.key}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "11px" }}>
                                      {file.httpMetadata?.contentType || "application/octet-stream"}
                                    </Typography>
                                  </Box>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                                {formatBytes(file.size)}
                              </TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
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
                                  <IconButton size="small" onClick={() => handleDownloadFile(file)}>
                                    <Download size={16} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="View details" arrow>
                                  <IconButton size="small" onClick={() => setDetailFile(file)}>
                                    <Info size={16} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="Delete" arrow>
                                  <IconButton
                                    size="small"
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
                  Keys authenticate REST API, cURL scripts, and S3-compatible SDKs against your storage buckets.
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
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 6, gap: 1 }}>
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
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: "12px" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ backgroundColor: "var(--muted)" }}>
                      <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                        Key Name
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                        Prefix / Key ID
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                        Permissions
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                        Created
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}>
                        Expires
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ fontWeight: 600, fontSize: "0.75rem", textTransform: "uppercase" }}
                      >
                        Actions
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {apiKeys.map((key) => (
                      <TableRow key={key.id} hover>
                        <TableCell sx={{ fontWeight: 500 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Key size={15} color="var(--muted-foreground)" />
                            <span>{key.name}</span>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                          <CopyField value={key.prefix || key.id} />
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={key.scopes}
                            sx={{ height: 22, fontSize: "0.75rem", borderRadius: "6px" }}
                          />
                        </TableCell>
                        <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                          <RelativeTime date={key.createdAt} />
                        </TableCell>
                        <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                          {key.expiresAt ? <RelativeTime date={key.expiresAt} /> : "Never"}
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Tooltip title="Revoke API key" arrow>
                            <IconButton
                              size="small"
                              onClick={() => setDeleteKeyTarget(key)}
                              sx={{
                                color: "var(--muted-foreground)",
                                "&:hover": { color: "var(--destructive)" },
                              }}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
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
