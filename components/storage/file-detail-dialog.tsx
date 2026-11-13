"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  Download,
  FileText,
  FileArchive,
  FileCode,
  Image as ImageIcon,
  Trash2,
  Terminal,
} from "lucide-react";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatBytes, downloadStorageFile, type StorageObject } from "@/lib/storage-client";

function getFileIcon(filename: string, contentType?: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (
    contentType?.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)
  ) {
    return <ImageIcon size={20} color="#3dd68c" />;
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) {
    return <FileArchive size={20} color="#f5a524" />;
  }
  if (
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "yaml", "yml", "sql", "sh"].includes(ext)
  ) {
    return <FileCode size={20} color="#3b82f6" />;
  }
  return <FileText size={20} color="var(--primary)" />;
}

export function FileDetailDialog({
  file,
  namespace,
  open,
  onOpenChange,
  onDelete,
}: {
  file: StorageObject | null;
  namespace: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (file: StorageObject) => void;
}) {
  const [isDownloading, setIsDownloading] = React.useState(false);
  const [downloadError, setDownloadError] = React.useState<string | null>(null);

  if (!file) return null;

  const filename = file.name || (file.key ?? "").split("/").pop() || "file";
  const contentType = file.httpMetadata?.contentType || "application/octet-stream";
  const isImage =
    contentType.startsWith("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg|avif)$/i.test(filename);

  const cleanPath = file.name || file.key;
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  const directApiUrl = `/api/v1/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`;

  const curlCommand = `curl -X GET "${typeof window !== "undefined" ? window.location.origin : ""}${directApiUrl}" \\
  -H "Authorization: Bearer <YOUR_API_KEY>" \\
  -o "${filename}"`;

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadError(null);
      await downloadStorageFile(namespace, cleanPath, filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} fullWidth maxWidth="sm">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              display: "inline-flex",
              width: 40,
              height: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "var(--muted)",
            }}
          >
            {getFileIcon(filename, contentType)}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
              {filename}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
              in storage bucket{" "}
              <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
                {namespace}
              </Box>
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {isImage && (
          <Paper
            variant="outlined"
            sx={{
              display: "flex",
              maxHeight: 224,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              borderRadius: "12px",
              backgroundColor: "var(--muted)",
              p: 1,
            }}
          >
            <Box
              component="img"
              src={directApiUrl}
              alt={filename}
              loading="lazy"
              sx={{
                maxHeight: 208,
                width: "auto",
                maxWidth: "100%",
                borderRadius: "8px",
                objectFit: "contain",
              }}
            />
          </Paper>
        )}

        <Paper
          variant="outlined"
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 1.5,
            borderRadius: "12px",
            backgroundColor: "var(--muted)",
            p: 1.75,
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              Path
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
            >
              {cleanPath}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              File Size
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {formatBytes(file.size)}{" "}
              <Box component="span" sx={{ fontWeight: 400, color: "var(--muted-foreground)" }}>
                ({file.size.toLocaleString()} bytes)
              </Box>
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              Content-Type
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
            >
              {contentType}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
              Uploaded
            </Typography>
            <Typography variant="caption">
              <RelativeTime date={file.uploaded} />
            </Typography>
          </Box>

          <Box sx={{ gridColumn: "1 / -1", pt: 1, borderTop: "1px solid var(--border)" }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, display: "block" }}>
              ETag (MD5)
            </Typography>
            <Typography variant="caption" noWrap sx={{ fontFamily: "var(--font-mono)", display: "block" }}>
              {file.etag}
            </Typography>
          </Box>
        </Paper>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Typography
              variant="caption"
              sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <Terminal size={14} color="var(--muted-foreground)" />
              cURL CLI Access
            </Typography>
            <CopyField value={curlCommand} label="Copy cURL command" />
          </Box>
          <Paper
            variant="outlined"
            component="pre"
            sx={{
              m: 0,
              overflowX: "auto",
              backgroundColor: "var(--muted)",
              p: 1.25,
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              color: "var(--muted-foreground)",
            }}
          >
            {curlCommand}
          </Paper>
        </Box>

        {downloadError && <Alert severity="error">{downloadError}</Alert>}
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 2, justifyContent: "space-between" }}>
        <Button
          type="button"
          variant="contained"
          color="error"
          size="small"
          startIcon={<Trash2 size={14} />}
          onClick={() => {
            onOpenChange(false);
            onDelete(file);
          }}
        >
          Delete File
        </Button>

        <Stack direction="row" spacing={1}>
          <Button type="button" variant="outlined" size="small" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            type="button"
            variant="contained"
            size="small"
            onClick={handleDownload}
            disabled={isDownloading}
            startIcon={
              isDownloading ? <CircularProgress size={14} color="inherit" /> : <Download size={14} />
            }
          >
            {isDownloading ? "Downloading..." : "Download"}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
