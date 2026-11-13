import { apiV1 } from "@/lib/api-v1";

/** Shape returned by the server via jsonOk() */
type ApiOkResponse<T> = { success: true; data: T };

export interface StorageUsageResponse {
  tenantId: string;
  status: string;
  plan: string;
  usedBytes: number;
  storageLimitBytes: number;
  storagePercent: number;
  fileCount: number;
  monthlyReadOps: number;
  monthlyReadLimitOps: number;
  monthlyReadPercent: number;
  monthlyWriteOps: number;
  monthlyWriteLimitOps: number;
  monthlyWritePercent: number;
  peakDailyBytes: number;
}

export interface StorageNamespace {
  id: string;
  name: string;
  tenantId?: string;
  objectCount?: number;
  totalBytes?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface StorageObject {
  key: string;
  name: string;
  path?: string;
  size: number;
  etag: string;
  uploaded: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface StorageApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string;
  expiresAt: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface CreateApiKeyInput {
  name: string;
  environment?: "live" | "test";
  projectId?: string;
  scopes?: string | string[];
  expiresInDays?: number;
}

export interface CreateApiKeyResult {
  apiKey: StorageApiKey;
  secretKey: string;
}

export interface ListFilesResult {
  objects: StorageObject[];
  prefixes: string[];
  cursor?: string;
  truncated: boolean;
}

export interface UploadStorageFileOptions {
  contentType?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, loaded: number, total: number) => void;
}

export async function fetchStorageUsage(): Promise<StorageUsageResponse> {
  const { data } = await apiV1.get<
    ApiOkResponse<{
      tenantId: string;
      plan: string;
      limits: {
        storageLimitBytes: number;
        monthlyReadLimitOps: number;
        monthlyWriteLimitOps: number;
        bandwidthLimitBytes?: number;
        egressRateLimitMbps?: number;
      };
      usage: {
        usedBytes: number;
        fileCount: number;
        monthlyReadOps: number;
        monthlyWriteOps: number;
        peakDailyBytes?: number;
      };
    }>
  >("/storage/usage");

  const { tenantId, plan, limits, usage } = data.data;
  const usedBytes = usage.usedBytes ?? 0;
  const storageLimitBytes = limits.storageLimitBytes ?? 536_870_912;
  const monthlyReadOps = usage.monthlyReadOps ?? 0;
  const monthlyReadLimitOps = limits.monthlyReadLimitOps ?? 100_000;
  const monthlyWriteOps = usage.monthlyWriteOps ?? 0;
  const monthlyWriteLimitOps = limits.monthlyWriteLimitOps ?? 100_000;

  return {
    tenantId,
    plan,
    status: "ok",
    usedBytes,
    storageLimitBytes,
    storagePercent:
      storageLimitBytes > 0
        ? Math.min(100, (usedBytes / storageLimitBytes) * 100)
        : 0,
    fileCount: usage.fileCount ?? 0,
    monthlyReadOps,
    monthlyReadLimitOps,
    monthlyReadPercent:
      monthlyReadLimitOps > 0
        ? Math.min(100, (monthlyReadOps / monthlyReadLimitOps) * 100)
        : 0,
    monthlyWriteOps,
    monthlyWriteLimitOps,
    monthlyWritePercent:
      monthlyWriteLimitOps > 0
        ? Math.min(100, (monthlyWriteOps / monthlyWriteLimitOps) * 100)
        : 0,
    peakDailyBytes: usage.peakDailyBytes ?? 0,
  };
}

export async function fetchNamespaces(): Promise<StorageNamespace[]> {
  const { data } = await apiV1.get<
    ApiOkResponse<{ tenantId: string; namespaces: StorageNamespace[] }>
  >("/storage/namespaces");
  const namespaces = data.data?.namespaces;
  return Array.isArray(namespaces) ? namespaces : [];
}

export async function fetchNamespaceDetails(name: string): Promise<StorageNamespace> {
  const { data } = await apiV1.get<ApiOkResponse<StorageNamespace>>(
    `/storage/namespaces/${encodeURIComponent(name)}`,
  );
  return data.data;
}

export async function createStorageNamespace(name: string): Promise<StorageNamespace> {
  const { data } = await apiV1.post<ApiOkResponse<StorageNamespace>>(
    "/storage/namespaces",
    { name },
  );
  return data.data;
}

export async function deleteStorageNamespace(name: string): Promise<void> {
  await apiV1.delete(`/storage/namespaces/${encodeURIComponent(name)}`);
}

export async function fetchFiles(
  namespace: string,
  options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<ListFilesResult> {
  const params = new URLSearchParams();
  if (options?.prefix) params.set("prefix", options.prefix);
  if (options?.delimiter) params.set("delimiter", options.delimiter);
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", options.limit.toString());

  const url = `/storage/namespaces/${encodeURIComponent(namespace)}/files${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const { data } = await apiV1.get<
    ApiOkResponse<{
      namespace: string;
      objects: StorageObject[];
      prefixes?: string[];
      cursor?: string;
      truncated?: boolean;
    }>
  >(url, { signal: options?.signal });
  return {
    objects: Array.isArray(data.data?.objects) ? data.data.objects : [],
    prefixes: Array.isArray(data.data?.prefixes) ? data.data.prefixes : [],
    cursor: data.data?.cursor,
    truncated: Boolean(data.data?.truncated),
  };
}

export async function uploadStorageFile(
  namespace: string,
  path: string,
  file: File | Blob,
  contentTypeOrOptions?: string | UploadStorageFileOptions,
): Promise<{ path: string; size: number; etag: string }> {
  const opts: UploadStorageFileOptions =
    typeof contentTypeOrOptions === "string"
      ? { contentType: contentTypeOrOptions }
      : (contentTypeOrOptions ?? {});

  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const resolvedContentType =
    opts.contentType ||
    (file instanceof File && file.type ? file.type : "application/octet-stream");

  const endpoint = `/api/v1/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`;

  // Use XMLHttpRequest when progress reporting is requested in the browser
  if (opts.onProgress && typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", endpoint, true);
      xhr.setRequestHeader("Content-Type", resolvedContentType);

      if (opts.signal) {
        if (opts.signal.aborted) {
          xhr.abort();
          reject(new DOMException("Upload aborted", "AbortError"));
          return;
        }
        opts.signal.addEventListener(
          "abort",
          () => {
            xhr.abort();
            reject(new DOMException("Upload aborted", "AbortError"));
          },
          { once: true },
        );
      }

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && opts.onProgress) {
          const pct = Math.min(100, Math.round((ev.loaded / ev.total) * 100));
          opts.onProgress(pct, ev.loaded, ev.total);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as ApiOkResponse<{
              path: string;
              size: number;
              etag: string;
            }>;
            opts.onProgress?.(100, file.size, file.size);
            resolve({
              path: parsed.data.path,
              size: parsed.data.size,
              etag: parsed.data.etag,
            });
          } catch {
            reject(new Error("Invalid upload response from server"));
          }
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try {
            const errBody = JSON.parse(xhr.responseText);
            if (errBody?.error?.message) msg = errBody.error.message;
            else if (errBody?.message) msg = errBody.message;
          } catch {
            // Fallback
          }
          reject(new Error(msg));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": resolvedContentType,
    },
    body: file,
    signal: opts.signal,
  });

  if (!response.ok) {
    let msg = `Upload failed (${response.status})`;
    try {
      const errBody = (await response.json()) as any;
      if (errBody?.error?.message) {
        msg = errBody.error.message;
      } else if (errBody?.message) {
        msg = errBody.message;
      }
    } catch {
      // Fallback
    }
    throw new Error(msg);
  }

  const body = (await response.json()) as ApiOkResponse<{
    path: string;
    size: number;
    etag: string;
    namespace?: string;
    uploadedAt?: string;
  }>;
  opts.onProgress?.(100, file.size, file.size);
  return { path: body.data.path, size: body.data.size, etag: body.data.etag };
}

export async function downloadStorageFile(
  namespace: string,
  path: string,
  filename?: string,
): Promise<void> {
  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const response = await fetch(
    `/api/v1/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`,
  );

  if (!response.ok) {
    let msg = `Download failed (${response.status})`;
    try {
      const data = (await response.json()) as any;
      if (data?.error?.message) {
        msg = data.error.message;
      }
    } catch {
      // Fallback
    }
    throw new Error(msg);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || cleanPath.split("/").pop() || "file";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

export async function deleteStorageFile(namespace: string, path: string): Promise<void> {
  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const { data } = await apiV1.delete(
    `/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`,
  );
  return data;
}

export async function fetchApiKeys(): Promise<StorageApiKey[]> {
  const { data } = await apiV1.get<ApiOkResponse<{ keys: StorageApiKey[] }>>(
    "/storage/api-keys",
  );
  const keys = data.data?.keys;
  return Array.isArray(keys) ? keys : [];
}

export async function createStorageApiKey(
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  const { data } = await apiV1.post<ApiOkResponse<CreateApiKeyResult>>(
    "/storage/api-keys",
    input,
  );
  return data.data;
}

export async function deleteStorageApiKey(keyId: string): Promise<void> {
  await apiV1.delete(`/storage/api-keys/${encodeURIComponent(keyId)}`);
}

/**
 * Determine the status of an API key (`active`, `revoked`, or `expired`).
 */
export function getApiKeyStatus(
  key: Pick<StorageApiKey, "revokedAt" | "expiresAt">,
): "active" | "revoked" | "expired" {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return "expired";
  }
  return "active";
}

/** Formats byte size into human readable string (e.g. 512 KB, 12.4 MB) */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
