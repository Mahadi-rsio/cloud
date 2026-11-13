"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { UploadCloud, File, X } from "lucide-react";
import { formatBytes, uploadStorageFile } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

export function UploadFileDialog({
  namespace,
  open,
  onOpenChange,
  onSuccess,
}: {
  namespace: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [customPath, setCustomPath] = React.useState("");
  const [isUploading, setIsUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setSelectedFile(null);
      setCustomPath("");
      setError(null);
      setIsUploading(false);
      setIsDragging(false);
    }
  }, [open]);

  const handleFileSelection = (file: File) => {
    setSelectedFile(file);
    const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    setCustomPath(cleanName);
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
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setError("Please select a file to upload.");
      return;
    }

    const path = customPath.trim().replace(/^\/+/, "");
    if (!path) {
      setError("File path cannot be empty.");
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      await uploadStorageFile(namespace, path, selectedFile, selectedFile.type);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !isUploading && onOpenChange(false)}
      fullWidth
      maxWidth="xs"
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
            Upload File
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Upload a file to storage bucket{" "}
            <Box component="code" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
              {namespace}
            </Box>
            .
          </DialogContentText>

          {!selectedFile ? (
            <Box
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
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
                p: 3,
                textAlign: "center",
                cursor: "pointer",
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
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleFileSelection(file);
                  }
                }}
                disabled={isUploading}
              />
              <Box
                sx={{
                  borderRadius: "9999px",
                  backgroundColor: "var(--muted)",
                  p: 1.5,
                  color: "var(--muted-foreground)",
                }}
              >
                <UploadCloud size={24} />
              </Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Click to select or drag & drop
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Up to 100 MB per file. Direct R2 stream with atomic quota check.
                </Typography>
              </Box>
            </Box>
          ) : (
            <Paper
              variant="outlined"
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderRadius: "12px",
                backgroundColor: "var(--muted)",
                p: 1.75,
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
                  <File size={20} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
                    {selectedFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(selectedFile.size)} • {selectedFile.type || "application/octet-stream"}
                  </Typography>
                </Box>
              </Box>
              {!isUploading && (
                <IconButton
                  size="small"
                  onClick={() => {
                    setSelectedFile(null);
                    setCustomPath("");
                  }}
                  sx={{ flexShrink: 0 }}
                >
                  <X size={16} />
                </IconButton>
              )}
            </Paper>
          )}

          {selectedFile && (
            <TextField
              id="file-path"
              label="Destination Path"
              size="small"
              fullWidth
              value={customPath}
              onChange={(e) => {
                setCustomPath(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. photos/holiday.jpg or logo.png"
              disabled={isUploading}
              helperText={
                <>
                  File will be stored as:{" "}
                  <Box component="code" sx={{ color: "var(--foreground)" }}>
                    {namespace}/{customPath || "..."}
                  </Box>
                </>
              }
            />
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
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isUploading || !selectedFile}
            startIcon={isUploading ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {isUploading ? "Uploading..." : "Upload File"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
