"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { UploadCloud, File, X, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { formatBytes, uploadStorageFile } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

export interface UploadQueueItem {
  id: string;
  file: File;
  path: string;
  status: "queued" | "uploading" | "done" | "error" | "cancelled";
  progress: number;
  error?: string;
}

export function UploadFileDialog({
  namespace,
  currentPrefix = "",
  open,
  onOpenChange,
  onSuccess,
}: {
  namespace: string;
  currentPrefix?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [queue, setQueue] = React.useState<UploadQueueItem[]>([]);
  const [folderPrefix, setFolderPrefix] = React.useState(currentPrefix);
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const abortControllersRef = React.useRef<Map<string, AbortController>>(new Map());

  React.useEffect(() => {
    if (open) {
      setQueue([]);
      setFolderPrefix(currentPrefix);
      setError(null);
      setIsUploading(false);
      setIsDragging(false);
      abortControllersRef.current.clear();
    }
  }, [open, currentPrefix]);

  const addFilesToQueue = (files: FileList | File[]) => {
    const items = Array.from(files);
    if (items.length === 0) return;

    const normalizedPrefix = folderPrefix.trim().replace(/^\/+|\/+$/g, "");
    const added: UploadQueueItem[] = items.map((file, idx) => {
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const defaultPath = normalizedPrefix ? `${normalizedPrefix}/${cleanName}` : cleanName;
      return {
        id: `${Date.now()}_${idx}_${cleanName}`,
        file,
        path: defaultPath,
        status: "queued",
        progress: 0,
      };
    });

    setQueue((prev) => [...prev, ...added]);
    setError(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  const handleCancelItem = (itemId: string) => {
    const ctrl = abortControllersRef.current.get(itemId);
    if (ctrl) {
      ctrl.abort();
      abortControllersRef.current.delete(itemId);
    }
    setQueue((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: item.status === "uploading" ? "cancelled" : item.status,
            }
          : item,
      ),
    );
  };

  const handleRemoveItem = (itemId: string) => {
    handleCancelItem(itemId);
    setQueue((prev) => prev.filter((item) => item.id !== itemId));
  };

  const uploadSingleItem = async (item: UploadQueueItem): Promise<boolean> => {
    const cleanPath = item.path.trim().replace(/^\/+/, "");
    if (!cleanPath) {
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? { ...q, status: "error", error: "Destination path cannot be empty." }
            : q,
        ),
      );
      return false;
    }

    const controller = new AbortController();
    abortControllersRef.current.set(item.id, controller);

    setQueue((prev) =>
      prev.map((q) =>
        q.id === item.id ? { ...q, status: "uploading", progress: 5, error: undefined } : q,
      ),
    );

    try {
      await uploadStorageFile(namespace, cleanPath, item.file, {
        contentType: item.file.type || "application/octet-stream",
        signal: controller.signal,
        onProgress: (pct) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress: pct } : q)),
          );
        },
      });
      abortControllersRef.current.delete(item.id);
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id ? { ...q, status: "done", progress: 100, error: undefined } : q,
        ),
      );
      return true;
    } catch (err) {
      abortControllersRef.current.delete(item.id);
      const isAborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        controller.signal.aborted;
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                status: isAborted ? "cancelled" : "error",
                error: isAborted ? "Cancelled" : extractErrorMessage(err),
              }
            : q,
        ),
      );
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingItems = queue.filter(
      (q) => q.status === "queued" || q.status === "error" || q.status === "cancelled",
    );
    if (pendingItems.length === 0) {
      setError("Please select at least one file to upload.");
      return;
    }

    setIsUploading(true);
    setError(null);
    let anySucceeded = false;
    let allSucceeded = true;

    for (const item of pendingItems) {
      const ok = await uploadSingleItem(item);
      if (ok) anySucceeded = true;
      else allSucceeded = false;
    }

    setIsUploading(false);

    if (anySucceeded) {
      onSuccess();
    }
    if (allSucceeded) {
      onOpenChange(false);
    }
  };

  const pendingCount = queue.filter(
    (q) => q.status === "queued" || q.status === "error" || q.status === "cancelled",
  ).length;

  return (
    <Dialog
      open={open}
      onClose={() => !isUploading && onOpenChange(false)}
      fullWidth
      maxWidth="sm"
    >
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1 }}>
          <Box
            sx={{
              mb: 1.5,
              display: "inline-flex",
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <UploadCloud size={20} />
          </Box>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            Upload Files
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Upload one or more files to storage bucket{" "}
            <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
              {namespace}
            </Box>
            .
          </DialogContentText>

          <Box
            role="button"
            tabIndex={0}
            aria-label="Select or drag and drop files to upload"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (!isUploading && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              borderRadius: "12px",
              border: "2px dashed",
              borderColor: isDragging ? "var(--primary)" : "var(--border)",
              backgroundColor: isDragging ? "rgba(56, 189, 248, 0.06)" : "transparent",
              p: 2.5,
              textAlign: "center",
              cursor: isUploading ? "default" : "pointer",
              transition: "all 0.15s ease",
              "&:hover": {
                borderColor: "var(--primary)",
                backgroundColor: "var(--muted)",
              },
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  addFilesToQueue(e.target.files);
                  e.target.value = "";
                }
              }}
              disabled={isUploading}
            />
            <Box
              sx={{
                borderRadius: "9999px",
                backgroundColor: "var(--muted)",
                p: 1.25,
                color: "var(--muted-foreground)",
              }}
            >
              <UploadCloud size={22} />
            </Box>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Click to select or drag & drop files
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Supports multi-file queue • Up to 100 MB per file with atomic quota reservation.
              </Typography>
            </Box>
          </Box>

          {queue.length > 0 && (
            <Stack spacing={1.25} sx={{ maxHeight: 280, overflowY: "auto", pr: 0.5 }}>
              {queue.map((item) => (
                <Paper
                  key={item.id}
                  variant="outlined"
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    borderRadius: "12px",
                    backgroundColor: "var(--muted)",
                    p: 1.5,
                  }}
                >
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
                      <Box
                        sx={{
                          borderRadius: "8px",
                          backgroundColor: "rgba(56, 189, 248, 0.12)",
                          p: 0.75,
                          color: "var(--primary)",
                          flexShrink: 0,
                        }}
                      >
                        <File size={16} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {item.file.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(item.file.size)} •{" "}
                          {item.file.type || "application/octet-stream"}
                        </Typography>
                      </Box>
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
                      {item.status === "done" && (
                        <Chip
                          size="small"
                          icon={<CheckCircle2 size={13} />}
                          label="Uploaded"
                          color="success"
                          sx={{ height: 22, fontSize: "0.7rem" }}
                        />
                      )}
                      {item.status === "error" && (
                        <Tooltip title="Retry upload" arrow>
                          <IconButton
                            size="small"
                            aria-label={`Retry ${item.file.name}`}
                            onClick={() => void uploadSingleItem(item)}
                            disabled={isUploading}
                          >
                            <RotateCcw size={15} />
                          </IconButton>
                        </Tooltip>
                      )}
                      <IconButton
                        size="small"
                        aria-label={
                          item.status === "uploading"
                            ? `Cancel ${item.file.name}`
                            : `Remove ${item.file.name}`
                        }
                        onClick={() =>
                          item.status === "uploading"
                            ? handleCancelItem(item.id)
                            : handleRemoveItem(item.id)
                        }
                      >
                        <X size={15} />
                      </IconButton>
                    </Box>
                  </Box>

                  {queue.length === 1 && item.status !== "done" ? (
                    <TextField
                      id="file-path"
                      label="Destination Path"
                      size="small"
                      fullWidth
                      value={item.path}
                      onChange={(e) => {
                        const val = e.target.value;
                        setQueue((prev) =>
                          prev.map((q) => (q.id === item.id ? { ...q, path: val } : q)),
                        );
                      }}
                      disabled={item.status === "uploading"}
                      placeholder="e.g. photos/holiday.jpg or logo.png"
                    />
                  ) : (
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--muted-foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {namespace}/{item.path}
                    </Typography>
                  )}

                  {(item.status === "uploading" || item.progress > 0) && (
                    <LinearProgress
                      variant="determinate"
                      value={item.progress}
                      color={item.status === "error" ? "error" : "primary"}
                      sx={{ height: 5, borderRadius: 3 }}
                    />
                  )}

                  {item.error && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "var(--destructive)" }}>
                      <AlertCircle size={13} />
                      <Typography variant="caption" color="error">
                        {item.error}
                      </Typography>
                    </Box>
                  )}
                </Paper>
              ))}
            </Stack>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            type="button"
            variant="outlined"
            onClick={() => onOpenChange(false)}
            disabled={isUploading}
          >
            {queue.length > 0 && pendingCount === 0 ? "Close" : "Cancel"}
          </Button>
          {pendingCount > 0 && (
            <Button
              type="submit"
              variant="contained"
              disabled={isUploading || pendingCount === 0}
              startIcon={
                isUploading ? <CircularProgress size={14} color="inherit" /> : undefined
              }
            >
              {isUploading
                ? "Uploading..."
                : pendingCount === 1
                  ? "Upload File"
                  : `Upload ${pendingCount} Files`}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
