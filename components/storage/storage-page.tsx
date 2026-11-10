"use client";

import * as React from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  Database,
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
  MoreHorizontal,
  ExternalLink,
  Info,
  Folder,
  Layers,
  Shield,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    return <ImageIcon className="size-4.5 text-emerald-500 shrink-0" />;
  }
  if (["zip", "tar", "gz", "tgz", "rar", "7z"].includes(ext)) {
    return <FileArchive className="size-4.5 text-amber-500 shrink-0" />;
  }
  if (
    ["js", "ts", "jsx", "tsx", "json", "html", "css", "yaml", "yml", "sql", "sh"].includes(ext)
  ) {
    return <FileCode className="size-4.5 text-blue-500 shrink-0" />;
  }
  return <FileText className="size-4.5 text-primary shrink-0" />;
}

export function StoragePage() {
  const [activeTab, setActiveTab] = React.useState<"files" | "keys">("files");

  // Top Quota Usage state
  const [usage, setUsage] = React.useState<StorageUsageResponse | null>(null);
  const [isLoadingUsage, setIsLoadingUsage] = React.useState(true);

  // Namespaces state
  const [namespaces, setNamespaces] = React.useState<StorageNamespace[]>([]);
  const [selectedNamespace, setSelectedNamespace] = React.useState<string>("");
  const [isLoadingNamespaces, setIsLoadingNamespaces] = React.useState(true);

  // Files state
  const [files, setFiles] = React.useState<StorageObject[]>([]);
  const [fileSearch, setFileSearch] = React.useState("");
  const [isLoadingFiles, setIsLoadingFiles] = React.useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = React.useState<StorageApiKey[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = React.useState(false);

  // Dialogs
  const [createStorageOpen, setCreateStorageOpen] = React.useState(false);
  const [uploadFileOpen, setUploadFileOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [detailFile, setDetailFile] = React.useState<StorageObject | null>(null);

  // Destructive delete dialogs
  const [deleteFileTarget, setDeleteFileTarget] = React.useState<StorageObject | null>(null);
  const [isDeletingFile, setIsDeletingFile] = React.useState(false);

  const [deleteStorageTarget, setDeleteStorageTarget] = React.useState<string | null>(null);
  const [isDeletingStorage, setIsDeletingStorage] = React.useState(false);

  const [deleteKeyTarget, setDeleteKeyTarget] = React.useState<StorageApiKey | null>(null);
  const [isDeletingKey, setIsDeletingKey] = React.useState(false);

  const [pageError, setPageError] = React.useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // 1. Load initial data
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

      // Auto-select first namespace if none selected or previous one disappeared
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

  // 2. Load files whenever selected namespace changes
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

  // 3. Load API keys whenever tab is switched to "keys"
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

  // Handlers for Storage Operations
  const handleStorageCreated = (created: StorageNamespace) => {
    setNamespaces((prev) => [...prev, created]);
    setSelectedNamespace(created.name);
    // Refresh usage
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
      // Refresh usage
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingStorage(false);
    }
  };

  // Handlers for File Operations
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
      // Refresh usage meter
      fetchStorageUsage().then(setUsage).catch(() => {});
    } catch (err) {
      setPageError(extractErrorMessage(err));
    } finally {
      setIsDeletingFile(false);
    }
  };

  // Handlers for API Key Operations
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

  // Filter files by search query
  const filteredFiles = React.useMemo(() => {
    if (!fileSearch.trim()) return files;
    const q = fileSearch.toLowerCase();
    return files.filter(
      (f) =>
        (f.name || f.key).toLowerCase().includes(q) ||
        (f.httpMetadata?.contentType || "").toLowerCase().includes(q)
    );
  }, [files, fileSearch]);

  const selectedNamespaceObj = namespaces.find((ns) => ns.name === selectedNamespace);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <PageHeader
        title="Storage"
        description="High-performance S3-compatible object storage powered by Cloudflare R2 and Durable Objects with free tier metering."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                loadInitialData();
                if (selectedNamespace) loadFilesForNamespace(selectedNamespace);
                if (activeTab === "keys") loadKeys();
              }}
              disabled={isRefreshing}
            >
              <RefreshCw className={`mr-1.5 size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {activeTab === "files" ? (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateStorageOpen(true)}
              >
                <FolderPlus className="mr-1.5 size-4" />
                New Storage
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreateKeyOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                Create API Key
              </Button>
            )}
          </div>
        }
      />

      {/* Quota & Metering Banner */}
      <QuotaMeterBar usage={usage} isLoading={isLoadingUsage} />

      {pageError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm font-medium text-destructive">
          {pageError}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "files" | "keys")}>
        <div className="border-b">
          <TabsList>
            <TabsTrigger value="files" className="gap-2">
              <HardDrive className="size-4" />
              Storages & Files
            </TabsTrigger>
            <TabsTrigger value="keys" className="gap-2">
              <Key className="size-4" />
              API Keys
            </TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: FILES & STORAGES */}
        <TabsContent value="files" className="mt-6 flex flex-col gap-6">
          {namespaces.length === 0 && !isLoadingNamespaces ? (
            <EmptyState
              icon={<FolderPlus className="size-6" />}
              title="No storages created yet"
              description="Create your first storage bucket namespace to begin uploading, downloading, and managing files."
              action={
                <Button onClick={() => setCreateStorageOpen(true)}>
                  <FolderPlus className="mr-1.5 size-4" />
                  Create Storage
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {/* Storage Selector Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-xl border bg-card p-3 sm:p-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                    <Folder className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Active Storage
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Select
                        value={selectedNamespace}
                        onChange={(e) => setSelectedNamespace(e.target.value)}
                        className="h-8 font-semibold text-sm max-w-xs"
                      >
                        {namespaces.map((ns) => (
                          <option key={ns.id || ns.name} value={ns.name}>
                            {ns.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setCreateStorageOpen(true)}
                        title="Create new storage"
                      >
                        <Plus className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setUploadFileOpen(true)}
                    disabled={!selectedNamespace}
                  >
                    <Upload className="mr-1.5 size-4" />
                    Upload File
                  </Button>
                  {selectedNamespace && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteStorageTarget(selectedNamespace)}
                      title="Delete storage"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Files Explorer Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Search files in this storage..."
                    value={fileSearch}
                    onChange={(e) => setFileSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
                <div className="text-xs text-muted-foreground self-end sm:self-center">
                  {filteredFiles.length} {filteredFiles.length === 1 ? "file" : "files"}
                  {files.length > 0 && (
                    <> • {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}</>
                  )}
                </div>
              </div>

              {/* Files Table / List */}
              {isLoadingFiles ? (
                <div className="flex flex-col items-center justify-center p-12 text-sm text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mb-2 text-primary" />
                  Loading files from R2...
                </div>
              ) : filteredFiles.length === 0 ? (
                files.length === 0 ? (
                  <EmptyState
                    icon={<Upload className="size-6" />}
                    title="No files in this storage"
                    description={`Storage "${selectedNamespace}" is currently empty. Upload files to get started.`}
                    action={
                      <Button onClick={() => setUploadFileOpen(true)}>
                        <Upload className="mr-1.5 size-4" />
                        Upload File
                      </Button>
                    }
                  />
                ) : (
                  <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    No files match your search query.
                  </div>
                )
              ) : (
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="py-3 px-4">Name</th>
                        <th className="py-3 px-4">Size</th>
                        <th className="py-3 px-4">Last Modified</th>
                        <th className="py-3 px-4">ETag</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredFiles.map((file) => {
                        const filename = file.name || (file.key ?? "").split("/").pop() || "file";
                        return (
                          <tr
                            key={file.key || file.name}
                            className="group transition-colors hover:bg-muted/30 cursor-pointer"
                            onClick={() => setDetailFile(file)}
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                {getFileIcon(filename, file.httpMetadata?.contentType)}
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate max-w-xs sm:max-w-md">
                                    {file.name || file.key}
                                  </p>
                                  <span className="text-[11px] text-muted-foreground">
                                    {file.httpMetadata?.contentType || "application/octet-stream"}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                              {formatBytes(file.size)}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                              <RelativeTime date={file.uploaded} />
                            </td>
                            <td className="py-3 px-4 font-mono text-xs text-muted-foreground max-w-[140px] truncate">
                              {file.etag}
                            </td>
                            <td
                              className="py-3 px-4 text-right whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleDownloadFile(file)}
                                  title="Download"
                                >
                                  <Download className="size-4 text-muted-foreground hover:text-foreground" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setDetailFile(file)}
                                  title="View details"
                                >
                                  <Info className="size-4 text-muted-foreground hover:text-foreground" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setDeleteFileTarget(file)}
                                  title="Delete"
                                  className="hover:text-destructive"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* TAB 2: API KEYS */}
        <TabsContent value="keys" className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Storage API Keys</h2>
              <p className="text-xs text-muted-foreground">
                Keys authenticate REST API, cURL scripts, and S3-compatible SDKs against your storage buckets.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateKeyOpen(true)}
              className="self-start sm:self-auto"
            >
              <Plus className="mr-1.5 size-4" />
              Create API Key
            </Button>
          </div>

          {isLoadingKeys ? (
            <div className="flex flex-col items-center justify-center p-12 text-sm text-muted-foreground">
              <RefreshCw className="size-5 animate-spin mb-2 text-primary" />
              Loading API keys...
            </div>
          ) : apiKeys.length === 0 ? (
            <EmptyState
              icon={<Key className="size-6" />}
              title="No API keys generated"
              description="Create an API key to securely upload, download, and manage storage programmatically."
              action={
                <Button onClick={() => setCreateKeyOpen(true)}>
                  <Plus className="mr-1.5 size-4" />
                  Create API Key
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-4">Key Name</th>
                    <th className="py-3 px-4">Prefix / Key ID</th>
                    <th className="py-3 px-4">Permissions</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4">Expires</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {apiKeys.map((key) => (
                    <tr key={key.id} className="transition-colors hover:bg-muted/30">
                      <td className="py-3 px-4 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          <Key className="size-4 text-muted-foreground" />
                          <span>{key.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs">
                        <CopyField value={key.prefix || key.id} />
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {key.scopes}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        <RelativeTime date={key.createdAt} />
                      </td>
                      <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                        {key.expiresAt ? (
                          <RelativeTime date={key.expiresAt} />
                        ) : (
                          <span className="text-muted-foreground">Never</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteKeyTarget(key)}
                          className="text-muted-foreground hover:text-destructive"
                          title="Revoke API key"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>

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

      {/* Delete File Confirmation */}
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
              <code className="font-semibold text-foreground">{selectedNamespace}</code>. This action cannot be undone.
            </>
          }
          isPending={isDeletingFile}
          onConfirm={handleConfirmDeleteFile}
        />
      )}

      {/* Delete Storage Confirmation */}
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
              <code className="font-semibold text-foreground">{deleteStorageTarget}</code> and all files stored within it.
            </>
          }
          confirmText={deleteStorageTarget}
          isPending={isDeletingStorage}
          onConfirm={handleConfirmDeleteStorage}
        />
      )}

      {/* Delete API Key Confirmation */}
      {deleteKeyTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteKeyTarget(null);
          }}
          title={`Revoke API Key "${deleteKeyTarget.name}"?`}
          description={
            <>
              Any application or script using this API key will immediately lose access to your storage buckets. This cannot be undone.
            </>
          }
          isPending={isDeletingKey}
          onConfirm={handleConfirmDeleteKey}
        />
      )}
    </div>
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
