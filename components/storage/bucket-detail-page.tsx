"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
  FileArchive,
  FileCode,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Key,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { ResourceRow } from "@/components/shared/resource-row";
import { StatCard } from "@/components/shared/stat-card";
import { UsageBar } from "@/components/shared/usage-bar";
import {
  deleteStorageFile,
  deleteStorageNamespace,
  downloadStorageFile,
  fetchFiles,
  fetchNamespaceDetails,
  fetchStorageUsage,
  formatBytes,
  uploadStorageFile,
  type StorageNamespace,
  type StorageObject,
  type StorageUsageResponse,
} from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

type BucketTab = "files" | "settings" | "usage";
type FileTypeFilter = "all" | "images" | "video" | "documents" | "archives" | "code";
type ViewMode = "list" | "grid";

interface UploadQueueItem {
  id: string;
  file: File;
  targetPath: string;
  progress: number;
  status: "uploading" | "done" | "error" | "cancelled";
  error?: string;
  controller: AbortController;
}

function getFileCategory(name: string, contentType?: string): FileTypeFilter {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    contentType?.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "ico"].includes(ext)
  ) {
    return "images";
  }
  if (contentType?.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
    return "video";
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) {
    return "archives";
  }
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "json",
      "html",
      "css",
      "yaml",
      "yml",
      "sql",
      "sh",
      "md",
    ].includes(ext)
  ) {
    return "code";
  }
  return "documents";
}

function getFileIcon(name: string, contentType?: string) {
  const cat = getFileCategory(name, contentType);
  if (cat === "images") return <ImageIcon size={17} color="#3dd68c" style={{ flexShrink: 0 }} />;
  if (cat === "video") return <Film size={17} color="#a78bfa" style={{ flexShrink: 0 }} />;
  if (cat === "archives") return <FileArchive size={17} color="#f5a524" style={{ flexShrink: 0 }} />;
  if (cat === "code") return <FileCode size={17} color="#38bdf8" style={{ flexShrink: 0 }} />;
  return <FileText size={17} color="var(--primary)" style={{ flexShrink: 0 }} />;
}

function getFileApiUrl(bucket: string, key: string): string {
  const cleanPath = key.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `/api/v1/storage/namespaces/${encodeURIComponent(bucket)}/files/${encodedPath}`;
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback
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

export function BucketDetailPage({ bucketName }: { bucketName: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isWide = useMediaQuery("(min-width:1024px)");
  const isMobile = useMediaQuery("(max-width:639px)");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const rawTab = searchParams.get("tab") as BucketTab | null;
  const activeTab: BucketTab =
    rawTab === "settings" || rawTab === "usage" ? rawTab : "files";

  const setActiveTab = React.useCallback(
    (tab: BucketTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "files") params.delete("tab");
      else params.set("tab", tab);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [bucket, setBucket] = React.useState<StorageNamespace | null>(null);
  const [usage, setUsage] = React.useState<StorageUsageResponse | null>(null);
  const [isLoadingBucket, setIsLoadingBucket] = React.useState(true);
  const [bucketError, setBucketError] = React.useState<string | null>(null);

  // Files state
  const [files, setFiles] = React.useState<StorageObject[]>([]);
  const [prefixes, setPrefixes] = React.useState<string[]>([]);
  const [currentPrefix, setCurrentPrefix] = React.useState("");
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(true);
  const [filesError, setFilesError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<FileTypeFilter>("all");
  const [viewMode, setViewMode] = React.useState<ViewMode>("list");
  const [selectedKeys, setSelectedKeys] = React.useState<Set<string>>(new Set());
  const [inspectedFile, setInspectedFile] = React.useState<StorageObject | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);

  // Upload queue
  const [uploads, setUploads] = React.useState<UploadQueueItem[]>([]);

  // Menus & Dialogs
  const [headerMenuAnchor, setHeaderMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [rowMenu, setRowMenu] = React.useState<{
    el: HTMLElement;
    file: StorageObject;
  } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<StorageObject | null>(null);
  const [renamePath, setRenamePath] = React.useState("");
  const [deleteFileTarget, setDeleteFileTarget] = React.useState<StorageObject | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [emptyBucketOpen, setEmptyBucketOpen] = React.useState(false);
  const [deleteBucketOpen, setDeleteBucketOpen] = React.useState(false);
  const [isPendingAction, setIsPendingAction] = React.useState(false);

  // Inspector signed URL state
  const [signedExpiry, setSignedExpiry] = React.useState("1h");
  const [signedUrl, setSignedUrl] = React.useState<string | null>(null);

  // Settings tab state
  const [isPublicBucket, setIsPublicBucket] = React.useState(false);
  const [corsText, setCorsText] = React.useState(
    '[\n  {\n    "allowedOrigins": ["*"],\n    "allowedMethods": ["GET", "PUT", "HEAD"],\n    "maxAgeSeconds": 3600\n  }\n]',
  );
  const [toast, setToast] = React.useState<string | null>(null);

  const loadBucketAndUsage = React.useCallback(async () => {
    setIsLoadingBucket(true);
    setBucketError(null);
    const [bRes, uRes] = await Promise.allSettled([
      fetchNamespaceDetails(bucketName),
      fetchStorageUsage(),
    ]);
    if (bRes.status === "fulfilled") {
      setBucket(bRes.value);
    } else {
      setBucketError(extractErrorMessage(bRes.reason));
    }
    if (uRes.status === "fulfilled") {
      setUsage(uRes.value);
    }
    setIsLoadingBucket(false);
  }, [bucketName]);

  const loadFiles = React.useCallback(
    async (prefix = currentPrefix) => {
      try {
        setIsLoadingFiles(true);
        setFilesError(null);
        setSelectedKeys(new Set());
        const res = await fetchFiles(bucketName, {
          prefix: prefix || undefined,
          delimiter: "/",
          limit: 200,
        });
        setFiles(res.objects);
        setPrefixes(res.prefixes);
      } catch (err) {
        setFilesError(extractErrorMessage(err));
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [bucketName, currentPrefix],
  );

  React.useEffect(() => {
    void loadBucketAndUsage();
  }, [loadBucketAndUsage]);

  React.useEffect(() => {
    void loadFiles(currentPrefix);
  }, [loadFiles, currentPrefix]);

  // Reset signed URL when inspected file changes
  React.useEffect(() => {
    setSignedUrl(null);
  }, [inspectedFile?.key]);

  // "/" keyboard shortcut to focus search
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (activeTab === "files") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab]);

  const startUploadFiles = React.useCallback(
    (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      incoming.forEach((file) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const controller = new AbortController();
        const targetPath = `${currentPrefix}${file.name}`;

        setUploads((prev) => [
          {
            id,
            file,
            targetPath,
            progress: 0,
            status: "uploading",
            controller,
          },
          ...prev,
        ]);

        void uploadStorageFile(bucketName, targetPath, file, {
          contentType: file.type || "application/octet-stream",
          signal: controller.signal,
          onProgress: (pct) => {
            setUploads((prev) =>
              prev.map((u) => (u.id === id ? { ...u, progress: pct } : u)),
            );
          },
        })
          .then(() => {
            setUploads((prev) =>
              prev.map((u) => (u.id === id ? { ...u, progress: 100, status: "done" } : u)),
            );
            void loadFiles(currentPrefix);
            void loadBucketAndUsage();
          })
          .catch((err) => {
            const aborted = err instanceof DOMException && err.name === "AbortError";
            setUploads((prev) =>
              prev.map((u) =>
                u.id === id
                  ? {
                      ...u,
                      status: aborted ? "cancelled" : "error",
                      error: aborted ? "Cancelled" : extractErrorMessage(err),
                    }
                  : u,
              ),
            );
          });
      });
    },
    [bucketName, currentPrefix, loadBucketAndUsage, loadFiles],
  );

  const retryUpload = (item: UploadQueueItem) => {
    setUploads((prev) => prev.filter((u) => u.id !== item.id));
    startUploadFiles([item.file]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer?.files?.length) {
      startUploadFiles(e.dataTransfer.files);
    }
  };

  const filteredFiles = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((f) => {
      const name = f.name || f.key;
      const mime = f.httpMetadata?.contentType ?? "";
      if (typeFilter !== "all" && getFileCategory(name, mime) !== typeFilter) {
        return false;
      }
      if (!q) return true;
      return f.key.toLowerCase().includes(q) || mime.toLowerCase().includes(q);
    });
  }, [files, searchQuery, typeFilter]);

  const toggleSelectAll = () => {
    if (selectedKeys.size === filteredFiles.length && filteredFiles.length > 0) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredFiles.map((f) => f.key)));
    }
  };

  const toggleSelectOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeleteSingleFile = async () => {
    if (!deleteFileTarget) return;
    try {
      setIsPendingAction(true);
      await deleteStorageFile(bucketName, deleteFileTarget.key);
      if (inspectedFile?.key === deleteFileTarget.key) setInspectedFile(null);
      setDeleteFileTarget(null);
      setToast("File deleted");
      await loadFiles(currentPrefix);
      void loadBucketAndUsage();
    } catch (err) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsPendingAction(false);
    }
  };

  const handleBulkDelete = async () => {
    const keys = Array.from(selectedKeys);
    if (keys.length === 0) return;
    try {
      setIsPendingAction(true);
      await Promise.all(keys.map((k) => deleteStorageFile(bucketName, k)));
      if (inspectedFile && selectedKeys.has(inspectedFile.key)) {
        setInspectedFile(null);
      }
      setSelectedKeys(new Set());
      setBulkDeleteOpen(false);
      setToast(`Deleted ${keys.length} file${keys.length === 1 ? "" : "s"}`);
      await loadFiles(currentPrefix);
      void loadBucketAndUsage();
    } catch (err) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsPendingAction(false);
    }
  };

  const handleBulkDownload = async () => {
    const keys = Array.from(selectedKeys);
    for (const k of keys) {
      await downloadStorageFile(bucketName, k);
    }
  };

  const handleEmptyBucket = async () => {
    try {
      setIsPendingAction(true);
      const all = await fetchFiles(bucketName, { limit: 1000 });
      await Promise.all(all.objects.map((o) => deleteStorageFile(bucketName, o.key)));
      setEmptyBucketOpen(false);
      setInspectedFile(null);
      setToast("Bucket emptied");
      await loadFiles("");
      setCurrentPrefix("");
      void loadBucketAndUsage();
    } catch (err) {
      setToast(extractErrorMessage(err));
    } finally {
      setIsPendingAction(false);
    }
  };

  const handleDeleteBucket = async () => {
    try {
      setIsPendingAction(true);
      await deleteStorageNamespace(bucketName);
      router.push("/storage");
    } catch (err) {
      setToast(extractErrorMessage(err));
      setIsPendingAction(false);
    }
  };

  const handleCreateFolder = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    setCurrentPrefix(`${currentPrefix}${clean}/`);
    setNewFolderName("");
    setNewFolderOpen(false);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Wire to rename/move endpoint when server supports object rename
    setRenameTarget(null);
    setToast("Object rename/move is not enabled on the server yet (stubbed)");
  };

  const handleGenerateSignedUrl = (file: StorageObject) => {
    // TODO: Wire to POST /api/v1/storage/namespaces/[bucket]/presign
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://cloud.rsioex.workers.dev";
    const expiresSeconds =
      signedExpiry === "15m"
        ? 900
        : signedExpiry === "1h"
          ? 3600
          : signedExpiry === "24h"
            ? 86400
            : 604800;
    const url = `${origin}${getFileApiUrl(bucketName, file.key)}?expiresIn=${expiresSeconds}`;
    setSignedUrl(url);
    void copyText(url);
    setToast(`Signed URL (${signedExpiry}) copied`);
  };

  const prefixSegments = currentPrefix.split("/").filter(Boolean);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://cloud.rsioex.workers.dev";
  const s3Endpoint = `${origin}/api/v1/storage/namespaces/${encodeURIComponent(bucketName)}`;

  const inspectorContent = inspectedFile ? (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 2, p: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700, flex: 1 }}>
          {inspectedFile.name || inspectedFile.key.split("/").pop()}
        </Typography>
        <IconButton size="small" aria-label="Close inspector" onClick={() => setInspectedFile(null)}>
          <X size={16} />
        </IconButton>
      </Box>

      {/* Preview for images, video, and PDF */}
      {(() => {
        const mime = inspectedFile.httpMetadata?.contentType ?? "";
        const cat = getFileCategory(inspectedFile.key, mime);
        const fileUrl = getFileApiUrl(bucketName, inspectedFile.key);
        const isPdf = mime === "application/pdf" || inspectedFile.key.toLowerCase().endsWith(".pdf");

        if (cat === "images") {
          return (
            <Box
              sx={{
                borderRadius: "10px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--muted)",
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                maxHeight: 220,
              }}
            >
              <Box
                component="img"
                src={fileUrl}
                alt={inspectedFile.key}
                sx={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }}
              />
            </Box>
          );
        }
        if (cat === "video") {
          return (
            <Box
              component="video"
              controls
              src={fileUrl}
              sx={{
                width: "100%",
                maxHeight: 220,
                borderRadius: "10px",
                border: "1px solid var(--border)",
                backgroundColor: "#000",
              }}
            />
          );
        }
        if (isPdf) {
          return (
            <Box
              component="iframe"
              title={inspectedFile.key}
              src={fileUrl}
              sx={{
                width: "100%",
                height: 220,
                borderRadius: "10px",
                border: "1px solid var(--border)",
                backgroundColor: "#fff",
              }}
            />
          );
        }
        return (
          <Box
            sx={{
              py: 3,
              borderRadius: "10px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            {getFileIcon(inspectedFile.key, mime)}
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              No inline preview available
            </Typography>
          </Box>
        );
      })()}

      {/* File Info */}
      <Stack spacing={1} sx={{ fontSize: "0.8rem" }}>
        <Box>
          <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
            Full path
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
            {inspectedFile.key}
          </Typography>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
          <Box>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              Size
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "var(--font-mono)" }}>
              {formatBytes(inspectedFile.size)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              MIME type
            </Typography>
            <Typography variant="body2" noWrap sx={{ fontFamily: "var(--font-mono)" }}>
              {inspectedFile.httpMetadata?.contentType || "application/octet-stream"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              ETag
            </Typography>
            <Typography variant="body2" noWrap sx={{ fontFamily: "var(--font-mono)" }}>
              {inspectedFile.etag || "-"}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
              Uploaded
            </Typography>
            <Typography variant="body2">
              <RelativeTime value={inspectedFile.uploaded} />
            </Typography>
          </Box>
        </Box>
      </Stack>

      <Divider />

      {/* Public / API URL */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
          Object URL
        </Typography>
        <Box
          sx={{
            px: 1.25,
            py: 0.75,
            borderRadius: "8px",
            border: "1px solid var(--border)",
            backgroundColor: "var(--muted)",
          }}
        >
          <CopyField value={`${origin}${getFileApiUrl(bucketName, inspectedFile.key)}`} sx={{ width: "100%" }} />
        </Box>
      </Box>

      {/* Signed URL Generator */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
          Signed URL
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            select
            size="small"
            value={signedExpiry}
            onChange={(e) => setSignedExpiry(e.target.value)}
            sx={{ width: 110 }}
          >
            <MenuItem value="15m">15 min</MenuItem>
            <MenuItem value="1h">1 hour</MenuItem>
            <MenuItem value="24h">24 hours</MenuItem>
            <MenuItem value="7d">7 days</MenuItem>
          </TextField>
          <Button
            variant="outlined"
            size="small"
            fullWidth
            onClick={() => handleGenerateSignedUrl(inspectedFile)}
          >
            Generate signed URL
          </Button>
        </Box>
        {signedUrl && (
          <Box
            sx={{
              px: 1.25,
              py: 0.75,
              borderRadius: "8px",
              border: "1px solid var(--border)",
              backgroundColor: "var(--muted)",
            }}
          >
            <CopyField value={signedUrl} sx={{ width: "100%" }} />
          </Box>
        )}
      </Box>

      {/* Actions */}
      <Stack direction="row" spacing={1} sx={{ mt: "auto", pt: 1, flexWrap: "wrap" }} useFlexGap>
        <Button
          variant="contained"
          size="small"
          startIcon={<Download size={14} />}
          onClick={() => void downloadStorageFile(bucketName, inspectedFile.key)}
        >
          Download
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Edit3 size={14} />}
          onClick={() => {
            setRenameTarget(inspectedFile);
            setRenamePath(inspectedFile.key);
          }}
        >
          Rename
        </Button>
        <Button
          variant="outlined"
          color="error"
          size="small"
          startIcon={<Trash2 size={14} />}
          onClick={() => setDeleteFileTarget(inspectedFile)}
        >
          Delete
        </Button>
      </Stack>
    </Box>
  ) : null;

  if (isLoadingBucket) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Skeleton variant="rounded" height={56} sx={{ borderRadius: "10px" }} />
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: "12px" }} />
      </Box>
    );
  }

  if (bucketError || !bucket) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Button
          startIcon={<ArrowLeft size={16} />}
          onClick={() => router.push("/storage")}
          sx={{ alignSelf: "flex-start" }}
        >
          Back to buckets
        </Button>
        <ErrorState
          title="Unable to load bucket"
          description={bucketError ?? "Bucket not found."}
          onRetry={() => void loadBucketAndUsage()}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Sticky Header + Tabs */}
      <Box
        sx={{
          position: "sticky",
          top: 64,
          zIndex: 20,
          backgroundColor: "var(--background)",
          pt: 0.5,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            pb: 1.5,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
            <Tooltip title="Back to buckets">
              <IconButton
                aria-label="Back to buckets"
                onClick={() => router.push("/storage")}
                sx={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  flexShrink: 0,
                }}
              >
                <ArrowLeft size={16} />
              </IconButton>
            </Tooltip>
            <Folder size={20} color="var(--primary)" style={{ flexShrink: 0 }} />
            <Typography
              variant="h5"
              component="h1"
              noWrap
              sx={{ fontWeight: 700, fontSize: { xs: "1.2rem", sm: "1.45rem" } }}
            >
              {bucketName}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Key size={14} />}
              onClick={() => router.push("/storage?tab=keys")}
              sx={{ display: { xs: "none", sm: "inline-flex" }, minHeight: 36, borderRadius: "9px" }}
            >
              API Keys
            </Button>
            <Tooltip title="Bucket actions">
              <IconButton
                aria-label="Bucket actions"
                onClick={(e) => setHeaderMenuAnchor(e.currentTarget)}
                sx={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                }}
              >
                <MoreHorizontal size={16} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Tabs
          value={activeTab}
          onChange={(_, v: BucketTab) => setActiveTab(v)}
          aria-label="Bucket sections"
          sx={{
            minHeight: 42,
            "& .MuiTab-root": {
              minHeight: 42,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.85rem",
            },
          }}
        >
          <Tab value="files" label="Files" />
          <Tab value="settings" label="Settings" />
          <Tab value="usage" label="Usage" />
        </Tabs>
      </Box>

      {/* Hidden file input for Upload button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            startUploadFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />

      {/* Tab 1: Files */}
      {activeTab === "files" && (
        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            borderRadius: "12px",
            outline: isDragOver ? "2px dashed var(--primary)" : "none",
            outlineOffset: 4,
          }}
        >
          {/* Toolbar */}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.25,
            }}
          >
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, flex: 1, minWidth: 220 }}>
              <TextField
                inputRef={searchInputRef}
                size="small"
                placeholder="Search by path or MIME... (Press /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{ width: { xs: "100%", sm: 260 } }}
                slotProps={{
                  input: {
                    sx: { borderRadius: "9px" },
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search size={15} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                select
                size="small"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as FileTypeFilter)}
                aria-label="Filter by file type"
                sx={{ width: { xs: "100%", sm: 145 } }}
                slotProps={{ input: { sx: { borderRadius: "9px" } } }}
              >
                <MenuItem value="all">All types</MenuItem>
                <MenuItem value="images">Images</MenuItem>
                <MenuItem value="video">Video</MenuItem>
                <MenuItem value="documents">Documents</MenuItem>
                <MenuItem value="archives">Archives</MenuItem>
                <MenuItem value="code">Code</MenuItem>
              </TextField>
            </Box>

            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <ToggleButtonGroup
                size="small"
                exclusive
                value={viewMode}
                onChange={(_, v) => v && setViewMode(v)}
                aria-label="View mode"
              >
                <ToggleButton value="list" aria-label="List view">
                  <Tooltip title="List view">
                    <ListIcon size={15} />
                  </Tooltip>
                </ToggleButton>
                <ToggleButton value="grid" aria-label="Grid view">
                  <Tooltip title="Grid view">
                    <LayoutGrid size={15} />
                  </Tooltip>
                </ToggleButton>
              </ToggleButtonGroup>

              <Tooltip title="Refresh files">
                <IconButton
                  size="small"
                  aria-label="Refresh files"
                  onClick={() => void loadFiles(currentPrefix)}
                  sx={{ width: 36, height: 36, border: "1px solid var(--border)", borderRadius: "9px" }}
                >
                  <RefreshCw size={15} />
                </IconButton>
              </Tooltip>

              <Button
                variant="outlined"
                size="small"
                startIcon={<FolderPlus size={15} />}
                onClick={() => setNewFolderOpen(true)}
                sx={{ minHeight: 36, borderRadius: "9px" }}
              >
                New folder
              </Button>

              <Button
                variant="contained"
                size="small"
                startIcon={<Upload size={15} />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ minHeight: 36, borderRadius: "9px" }}
              >
                Upload file
              </Button>
            </Stack>
          </Box>

          {/* Breadcrumb path navigation */}
          <Breadcrumbs separator={<ChevronRight size={14} />} aria-label="Folder breadcrumb">
            <Link
              component="button"
              type="button"
              underline="hover"
              color={currentPrefix ? "text.secondary" : "text.primary"}
              sx={{ fontWeight: currentPrefix ? 500 : 600, fontSize: "0.85rem" }}
              onClick={() => setCurrentPrefix("")}
            >
              {bucketName}
            </Link>
            {prefixSegments.map((seg, idx) => {
              const target = `${prefixSegments.slice(0, idx + 1).join("/")}/`;
              const isLast = idx === prefixSegments.length - 1;
              return (
                <Link
                  key={target}
                  component="button"
                  type="button"
                  underline="hover"
                  color={isLast ? "text.primary" : "text.secondary"}
                  sx={{ fontWeight: isLast ? 600 : 500, fontSize: "0.85rem" }}
                  onClick={() => setCurrentPrefix(target)}
                >
                  {seg}
                </Link>
              );
            })}
          </Breadcrumbs>

          {/* Upload Progress Queue */}
          {uploads.length > 0 && (
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: "10px",
                borderColor: "var(--border)",
                backgroundColor: "var(--card)",
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  Uploads ({uploads.length})
                </Typography>
                <Button
                  size="small"
                  onClick={() =>
                    setUploads((prev) => prev.filter((u) => u.status === "uploading"))
                  }
                >
                  Clear finished
                </Button>
              </Box>
              {uploads.map((item) => (
                <Box
                  key={item.id}
                  sx={{ display: "flex", alignItems: "center", gap: 1.5, fontSize: "0.8rem" }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography variant="caption" noWrap sx={{ fontWeight: 500 }}>
                        {item.targetPath}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                        {item.status === "uploading"
                          ? `${item.progress}%`
                          : item.status === "done"
                            ? "Uploaded"
                            : item.error || item.status}
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={item.progress}
                      color={
                        item.status === "error"
                          ? "error"
                          : item.status === "done"
                            ? "success"
                            : "primary"
                      }
                      sx={{ height: 5, borderRadius: 999 }}
                    />
                  </Box>
                  {item.status === "uploading" && (
                    <Tooltip title="Cancel upload">
                      <IconButton size="small" onClick={() => item.controller.abort()}>
                        <X size={14} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {(item.status === "error" || item.status === "cancelled") && (
                    <Tooltip title="Retry upload">
                      <IconButton size="small" onClick={() => retryUpload(item)}>
                        <RotateCcw size={14} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ))}
            </Paper>
          )}

          {/* Bulk Select Bar */}
          {selectedKeys.size > 0 && (
            <Paper
              variant="outlined"
              sx={{
                px: 2,
                py: 1,
                borderRadius: "10px",
                borderColor: "var(--primary)",
                backgroundColor: "color-mix(in oklab, var(--primary) 8%, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1.5,
                flexWrap: "wrap",
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {selectedKeys.size} selected
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Download size={14} />}
                  onClick={() => void handleBulkDownload()}
                >
                  Download selected
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<Trash2 size={14} />}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  Delete selected
                </Button>
              </Stack>
            </Paper>
          )}

          {/* Master/Detail Split */}
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
              minWidth: 0,
            }}
          >
            {/* Left: File List or Grid */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {isLoadingFiles ? (
                <Paper variant="outlined" sx={{ p: 2, borderRadius: "12px", borderColor: "var(--border)" }}>
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} height={44} sx={{ my: 0.5 }} />
                  ))}
                </Paper>
              ) : filesError ? (
                <ErrorState
                  title="Failed to load files"
                  description={filesError}
                  onRetry={() => void loadFiles(currentPrefix)}
                />
              ) : prefixes.length === 0 && filteredFiles.length === 0 ? (
                <EmptyState
                  icon={<Upload size={22} />}
                  title={files.length === 0 ? "Drop files here to upload" : "No matching files"}
                  description={
                    files.length === 0
                      ? "Drag and drop files anywhere in this area, or click Upload file."
                      : "Try clearing your search or type filter."
                  }
                  action={
                    files.length === 0 ? (
                      <Button
                        variant="contained"
                        startIcon={<Upload size={16} />}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Upload file
                      </Button>
                    ) : (
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setSearchQuery("");
                          setTypeFilter("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    )
                  }
                />
              ) : viewMode === "grid" ? (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "repeat(2, minmax(0, 1fr))",
                      sm: "repeat(3, minmax(0, 1fr))",
                      lg: inspectedFile ? "repeat(3, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))",
                    },
                    gap: 1.5,
                  }}
                >
                  {prefixes.map((prefix) => {
                    const folderLabel = prefix.slice(currentPrefix.length).replace(/\/$/, "");
                    return (
                      <Paper
                        key={prefix}
                        variant="outlined"
                        onClick={() => setCurrentPrefix(prefix)}
                        sx={{
                          p: 1.5,
                          borderRadius: "10px",
                          borderColor: "var(--border)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 1.25,
                          "&:hover": { backgroundColor: "var(--accent)" },
                        }}
                      >
                        <Folder size={18} color="var(--primary)" />
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {folderLabel}
                        </Typography>
                      </Paper>
                    );
                  })}
                  {filteredFiles.map((file) => {
                    const displayName = file.name || file.key.slice(currentPrefix.length);
                    const mime = file.httpMetadata?.contentType ?? "";
                    const isImg = getFileCategory(displayName, mime) === "images";
                    const selected = inspectedFile?.key === file.key;

                    return (
                      <Paper
                        key={file.key}
                        variant="outlined"
                        onClick={() => setInspectedFile(file)}
                        sx={{
                          p: 1.25,
                          borderRadius: "10px",
                          borderColor: selected ? "var(--primary)" : "var(--border)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                          "&:hover": { backgroundColor: "var(--accent)" },
                        }}
                      >
                        <Box
                          sx={{
                            height: 96,
                            borderRadius: "8px",
                            backgroundColor: "var(--muted)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                          }}
                        >
                          {isImg ? (
                            <Box
                              component="img"
                              src={getFileApiUrl(bucketName, file.key)}
                              alt={displayName}
                              sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            getFileIcon(displayName, mime)
                          )}
                        </Box>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 0.5 }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                              {displayName}
                            </Typography>
                            <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                              {formatBytes(file.size)}
                            </Typography>
                          </Box>
                          <IconButton
                            size="small"
                            aria-label={`Actions for ${displayName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowMenu({ el: e.currentTarget, file });
                            }}
                          >
                            <MoreHorizontal size={15} />
                          </IconButton>
                        </Box>
                      </Paper>
                    );
                  })}
                </Box>
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
                    <Table size="small" aria-label="Bucket files table">
                      <TableHead>
                        <TableRow
                          sx={{
                            "& th": {
                              fontWeight: 600,
                              fontSize: "0.72rem",
                              color: "var(--muted-foreground)",
                              textTransform: "uppercase",
                              borderBottomColor: "var(--border)",
                              py: 1.125,
                            },
                          }}
                        >
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={
                                filteredFiles.length > 0 &&
                                selectedKeys.size === filteredFiles.length
                              }
                              indeterminate={
                                selectedKeys.size > 0 &&
                                selectedKeys.size < filteredFiles.length
                              }
                              onChange={toggleSelectAll}
                              aria-label="Select all files"
                            />
                          </TableCell>
                          <TableCell>Name</TableCell>
                          <TableCell>Size</TableCell>
                          <TableCell>MIME type</TableCell>
                          <TableCell>Last modified</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {prefixes.map((prefix) => {
                          const folderLabel = prefix.slice(currentPrefix.length).replace(/\/$/, "");
                          return (
                            <TableRow
                              key={prefix}
                              hover
                              onClick={() => setCurrentPrefix(prefix)}
                              sx={{
                                cursor: "pointer",
                                "& td": { borderBottomColor: "var(--border)", py: 1 },
                              }}
                            >
                              <TableCell padding="checkbox" />
                              <TableCell>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                                  <Folder size={17} color="var(--primary)" />
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {folderLabel}/
                                  </Typography>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)" }}>-</TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)" }}>folder</TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)" }}>-</TableCell>
                              <TableCell align="right" />
                            </TableRow>
                          );
                        })}
                        {filteredFiles.map((file) => {
                          const displayName = file.name || file.key.slice(currentPrefix.length);
                          const mime =
                            file.httpMetadata?.contentType || "application/octet-stream";
                          const isChecked = selectedKeys.has(file.key);
                          const isInspected = inspectedFile?.key === file.key;

                          return (
                            <TableRow
                              key={file.key}
                              hover
                              selected={isInspected}
                              onClick={() => setInspectedFile(file)}
                              sx={{
                                cursor: "pointer",
                                "& td": { borderBottomColor: "var(--border)", py: 1 },
                                "&:last-child td": { borderBottom: 0 },
                              }}
                            >
                              <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  size="small"
                                  checked={isChecked}
                                  onChange={() => toggleSelectOne(file.key)}
                                  aria-label={`Select ${displayName}`}
                                />
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
                                  {getFileIcon(displayName, mime)}
                                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                                    {displayName}
                                  </Typography>
                                </Box>
                              </TableCell>
                              <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
                                {formatBytes(file.size)}
                              </TableCell>
                              <TableCell
                                sx={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: "0.75rem",
                                  color: "var(--muted-foreground)",
                                  maxWidth: 180,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {mime}
                              </TableCell>
                              <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.8rem" }}>
                                <RelativeTime value={file.uploaded} />
                              </TableCell>
                              <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                <IconButton
                                  size="small"
                                  aria-label={`Actions for ${displayName}`}
                                  onClick={(e) => setRowMenu({ el: e.currentTarget, file })}
                                >
                                  <MoreHorizontal size={16} />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {/* Mobile Two-Line Rows (<900px) */}
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
                    {prefixes.map((prefix, idx) => {
                      const folderLabel = prefix.slice(currentPrefix.length).replace(/\/$/, "");
                      return (
                        <React.Fragment key={prefix}>
                          {idx > 0 && <Divider />}
                          <ResourceRow
                            onClick={() => setCurrentPrefix(prefix)}
                            icon={<Folder size={16} />}
                            primary={
                              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                                {folderLabel}/
                              </Typography>
                            }
                            secondary={<span>Folder</span>}
                          />
                        </React.Fragment>
                      );
                    })}
                    {filteredFiles.map((file, idx) => {
                      const displayName = file.name || file.key.slice(currentPrefix.length);
                      const mime = file.httpMetadata?.contentType;
                      return (
                        <React.Fragment key={file.key}>
                          {(prefixes.length > 0 || idx > 0) && <Divider />}
                          <ResourceRow
                            onClick={() => setInspectedFile(file)}
                            selected={inspectedFile?.key === file.key}
                            leading={
                              <Checkbox
                                size="small"
                                checked={selectedKeys.has(file.key)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleSelectOne(file.key)}
                                aria-label={`Select ${displayName}`}
                              />
                            }
                            icon={getFileIcon(displayName, mime)}
                            primary={
                              <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                                {displayName}
                              </Typography>
                            }
                            secondary={
                              <>
                                <span>{formatBytes(file.size)}</span>
                                <span>•</span>
                                <RelativeTime value={file.uploaded} />
                              </>
                            }
                            trailing={
                              <IconButton
                                size="small"
                                aria-label={`Actions for ${displayName}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRowMenu({ el: e.currentTarget, file });
                                }}
                              >
                                <MoreHorizontal size={16} />
                              </IconButton>
                            }
                          />
                        </React.Fragment>
                      );
                    })}
                  </Paper>
                </>
              )}
            </Box>

            {/* Desktop Right Inspector Panel (>=1024px) */}
            {isWide && inspectedFile && (
              <Paper
                variant="outlined"
                sx={{
                  width: 370,
                  flexShrink: 0,
                  borderRadius: "12px",
                  borderColor: "var(--border)",
                  backgroundColor: "var(--card)",
                  position: "sticky",
                  top: 190,
                }}
              >
                {inspectorContent}
              </Paper>
            )}
          </Box>
        </Box>
      )}

      {/* Tab 2: Settings */}
      {activeTab === "settings" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, maxWidth: 720 }}>
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <SettingsIcon size={16} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Bucket configuration
              </Typography>
            </Box>

            <TextField
              label="Bucket name"
              size="small"
              fullWidth
              value={bucketName}
              slotProps={{ input: { readOnly: true } }}
            />

            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                S3-compatible endpoint
              </Typography>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--muted)",
                }}
              >
                <CopyField value={s3Endpoint} sx={{ width: "100%" }} />
              </Box>
            </Box>

            <TextField
              label="Region"
              size="small"
              fullWidth
              value="auto (Global Edge)"
              slotProps={{ input: { readOnly: true } }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={isPublicBucket}
                  onChange={(e) => {
                    // TODO: Wire to bucket ACL endpoint
                    setIsPublicBucket(e.target.checked);
                    setToast("Bucket visibility updated (preview stub)");
                  }}
                />
              }
              label="Public read access"
            />

            <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Key size={14} />}
                onClick={() => router.push("/storage?tab=keys")}
              >
                Manage API Keys
              </Button>
            </Box>
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              CORS policy
            </Typography>
            <TextField
              multiline
              minRows={5}
              fullWidth
              value={corsText}
              onChange={(e) => setCorsText(e.target.value)}
              slotProps={{
                input: { sx: { fontFamily: "var(--font-mono)", fontSize: "0.8rem" } },
              }}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="contained"
                size="small"
                onClick={() => {
                  // TODO: Wire to bucket CORS endpoint
                  setToast("CORS configuration saved (stubbed)");
                }}
              >
                Save CORS policy
              </Button>
            </Box>
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "rgba(229, 72, 77, 0.35)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "var(--destructive)" }}>
              Danger zone
            </Typography>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 1.5,
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Empty bucket
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  Delete all objects inside {bucketName} while keeping the bucket.
                </Typography>
              </Box>
              <Button
                variant="outlined"
                color="error"
                onClick={() => setEmptyBucketOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Empty bucket
              </Button>
            </Box>
            <Divider />
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 1.5,
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Delete bucket
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  Permanently delete this bucket and all of its objects.
                </Typography>
              </Box>
              <Button
                variant="contained"
                color="error"
                onClick={() => setDeleteBucketOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Delete bucket
              </Button>
            </Box>
          </Paper>
        </Box>
      )}

      {/* Tab 3: Usage */}
      {activeTab === "usage" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
              gap: 2,
            }}
          >
            <StatCard
              label="Objects in bucket"
              value={(bucket.objectCount ?? files.length).toLocaleString()}
              icon={<Folder size={14} />}
            />
            <StatCard
              label="Bucket size"
              value={formatBytes(bucket.totalBytes ?? 0)}
              icon={<HardDrive size={14} />}
            />
            <StatCard
              label="Account storage"
              value={usage ? formatBytes(usage.usedBytes) : "-"}
              subtext={
                usage ? (
                  <UsageBar
                    compact
                    valueLabel={`${usage.storagePercent.toFixed(1)}% of ${formatBytes(usage.storageLimitBytes)}`}
                    percent={usage.storagePercent}
                    sx={{ mt: 1 }}
                  />
                ) : undefined
              }
            />
          </Box>
        </Box>
      )}

      {/* Mobile/Tablet Inspector Drawer (<1024px) */}
      <Drawer
        anchor={isMobile ? "bottom" : "right"}
        open={!isWide && Boolean(inspectedFile)}
        onClose={() => setInspectedFile(null)}
        slotProps={{
          paper: {
            sx: {
              width: isMobile ? "100%" : 380,
              maxHeight: isMobile ? "88dvh" : "100%",
              borderRadius: isMobile ? "16px 16px 0 0" : 0,
              backgroundColor: "var(--card)",
            },
          },
        }}
      >
        {inspectorContent}
      </Drawer>

      {/* Header Overflow Menu */}
      <Menu
        anchorEl={headerMenuAnchor}
        open={Boolean(headerMenuAnchor)}
        onClose={() => setHeaderMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            setHeaderMenuAnchor(null);
            setActiveTab("settings");
          }}
        >
          <ListItemIcon>
            <Edit3 size={16} />
          </ListItemIcon>
          Rename / Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setHeaderMenuAnchor(null);
            setEmptyBucketOpen(true);
          }}
        >
          <ListItemIcon>
            <Trash2 size={16} />
          </ListItemIcon>
          Empty bucket
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setHeaderMenuAnchor(null);
            setDeleteBucketOpen(true);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete bucket
        </MenuItem>
      </Menu>

      {/* File Row Actions Menu */}
      <Menu
        anchorEl={rowMenu?.el ?? null}
        open={Boolean(rowMenu)}
        onClose={() => setRowMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            const f = rowMenu?.file;
            setRowMenu(null);
            if (f) {
              void copyText(`${origin}${getFileApiUrl(bucketName, f.key)}`);
              setToast("Object URL copied");
            }
          }}
        >
          <ListItemIcon>
            <Copy size={16} />
          </ListItemIcon>
          Copy URL
        </MenuItem>
        <MenuItem
          onClick={() => {
            const f = rowMenu?.file;
            setRowMenu(null);
            if (f) void downloadStorageFile(bucketName, f.key);
          }}
        >
          <ListItemIcon>
            <Download size={16} />
          </ListItemIcon>
          Download
        </MenuItem>
        <MenuItem
          onClick={() => {
            const f = rowMenu?.file;
            setRowMenu(null);
            if (f) {
              setRenameTarget(f);
              setRenamePath(f.key);
            }
          }}
        >
          <ListItemIcon>
            <Edit3 size={16} />
          </ListItemIcon>
          Rename / Move
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            const f = rowMenu?.file;
            setRowMenu(null);
            if (f) setDeleteFileTarget(f);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete
        </MenuItem>
      </Menu>

      {/* New Folder Dialog */}
      <Dialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={handleCreateFolder}>
          <DialogTitle>New folder</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Folder name"
              size="small"
              fullWidth
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="images"
              sx={{ mt: 0.5 }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button variant="outlined" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={!newFolderName.trim()}>
              Open folder
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Rename / Move Dialog */}
      <Dialog
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        fullWidth
        maxWidth="xs"
      >
        <Box component="form" onSubmit={handleRenameSubmit}>
          <DialogTitle>Rename / Move object</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Object key"
              size="small"
              fullWidth
              value={renamePath}
              onChange={(e) => setRenamePath(e.target.value)}
              sx={{ mt: 0.5 }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button variant="outlined" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={!renamePath.trim()}>
              Save
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDeleteDialog
        open={Boolean(deleteFileTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteFileTarget(null);
        }}
        title="Delete file"
        description={
          <>
            Permanently delete <strong>{deleteFileTarget?.key}</strong>?
          </>
        }
        confirmLabel="Delete file"
        isPending={isPendingAction}
        onConfirm={() => void handleDeleteSingleFile()}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected files"
        description={`Permanently delete ${selectedKeys.size} selected file${selectedKeys.size === 1 ? "" : "s"}?`}
        confirmLabel="Delete selected"
        isPending={isPendingAction}
        onConfirm={() => void handleBulkDelete()}
      />

      <ConfirmDialog
        open={emptyBucketOpen}
        onOpenChange={setEmptyBucketOpen}
        title="Empty bucket"
        description={
          <>
            This deletes all objects inside <strong>{bucketName}</strong>.
          </>
        }
        confirmLabel="Empty bucket"
        isPending={isPendingAction}
        onConfirm={() => void handleEmptyBucket()}
      />

      <ConfirmDeleteDialog
        open={deleteBucketOpen}
        onOpenChange={setDeleteBucketOpen}
        title="Delete bucket"
        description={
          <>
            This permanently deletes bucket <strong>{bucketName}</strong> and all objects inside it.
          </>
        }
        confirmText={bucketName}
        confirmLabel="Delete bucket"
        isPending={isPendingAction}
        onConfirm={() => void handleDeleteBucket()}
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
