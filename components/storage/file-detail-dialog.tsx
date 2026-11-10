"use client";

import * as React from "react";
import {
  Download,
  File,
  FileText,
  FileArchive,
  FileCode,
  Image as ImageIcon,
  Trash2,
  Calendar,
  HardDrive,
  Hash,
  Terminal,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { formatBytes, downloadStorageFile, type StorageObject } from "@/lib/storage-client";

function getFileIcon(filename: string, contentType?: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (
    contentType?.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)
  ) {
    return <ImageIcon className="size-5 text-emerald-500" />;
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) {
    return <FileArchive className="size-5 text-amber-500" />;
  }
  if (
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "yaml", "yml", "sql", "sh"].includes(ext)
  ) {
    return <FileCode className="size-5 text-blue-500" />;
  }
  return <FileText className="size-5 text-primary" />;
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

  const filename = file.name || file.key.split("/").pop() || "file";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="inline-flex size-10 items-center justify-center rounded-lg bg-muted">
              {getFileIcon(filename, contentType)}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base font-semibold">
                {filename}
              </DialogTitle>
              <DialogDescription className="truncate text-xs text-muted-foreground">
                in storage bucket <code className="font-semibold text-foreground">{namespace}</code>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Image Preview if applicable */}
          {isImage && (
            <div className="flex max-h-56 items-center justify-center overflow-hidden rounded-xl border bg-muted/20 p-2">
              <img
                src={directApiUrl}
                alt={filename}
                className="max-h-52 w-auto max-w-full rounded-lg object-contain"
                loading="lazy"
              />
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border bg-muted/20 p-3.5 text-xs">
            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Path</span>
              <span className="font-mono text-foreground break-all">{cleanPath}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">File Size</span>
              <span className="font-semibold text-foreground">
                {formatBytes(file.size)} <span className="font-normal text-muted-foreground">({file.size.toLocaleString()} bytes)</span>
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Content-Type</span>
              <span className="font-mono text-foreground break-all">{contentType}</span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="font-medium text-muted-foreground">Uploaded</span>
              <span className="text-foreground">
                <RelativeTime date={file.uploaded} />
              </span>
            </div>

            <div className="col-span-2 flex flex-col gap-1 border-t pt-2">
              <span className="font-medium text-muted-foreground">ETag (MD5)</span>
              <span className="font-mono text-xs text-foreground truncate">{file.etag}</span>
            </div>
          </div>

          {/* cURL programmatic access snippet */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Terminal className="size-3.5 text-muted-foreground" />
                cURL CLI Access
              </span>
              <CopyField value={curlCommand} label="Copy cURL command" />
            </div>
            <pre className="overflow-x-auto rounded-lg border bg-muted/60 p-2.5 font-mono text-[11px] text-muted-foreground">
              {curlCommand}
            </pre>
          </div>

          {downloadError && (
            <div className="rounded-lg bg-destructive/10 p-2.5 text-xs font-medium text-destructive">
              {downloadError}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 border-t pt-3">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onDelete(file);
            }}
          >
            <Trash2 className="mr-1.5 size-4" />
            Delete File
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="mr-1.5 size-4" />
                  Download
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
