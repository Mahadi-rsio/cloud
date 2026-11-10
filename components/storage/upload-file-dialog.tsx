"use client";

import * as React from "react";
import { UploadCloud, File, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    // Sanitize default filename path
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UploadCloud className="size-5" />
            </div>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>
              Upload a file to storage bucket <code className="font-semibold text-foreground">{namespace}</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {/* Drag & Drop Area */}
            {!selectedFile ? (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileSelection(file);
                    }
                  }}
                  disabled={isUploading}
                />
                <div className="rounded-full bg-muted p-3 text-muted-foreground">
                  <UploadCloud className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Click to select or drag & drop
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Up to 100 MB per file. Direct R2 stream with atomic quota check.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                    <File className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(selectedFile.size)} • {selectedFile.type || "application/octet-stream"}
                    </p>
                  </div>
                </div>
                {!isUploading && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => {
                      setSelectedFile(null);
                      setCustomPath("");
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            )}

            {/* Destination Path Input */}
            {selectedFile && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="file-path">Destination Path</Label>
                <Input
                  id="file-path"
                  value={customPath}
                  onChange={(e) => {
                    setCustomPath(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="e.g. photos/holiday.jpg or logo.png"
                  disabled={isUploading}
                />
                <p className="text-xs text-muted-foreground">
                  File will be stored as: <code className="text-foreground">{namespace}/{customPath || "..."}</code>
                </p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isUploading || !selectedFile}>
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Upload File"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
