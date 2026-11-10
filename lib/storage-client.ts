import { apiV1 } from "@/lib/api-v1";
import { extractErrorMessage } from "@/lib/errors";

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
  scopes?: string;
  expiresInDays?: number;
}

export interface CreateApiKeyResult {
  apiKey: StorageApiKey;
  secretKey: string;
}

export async function fetchStorageUsage(): Promise<StorageUsageResponse> {
  const { data } = await apiV1.get<StorageUsageResponse>("/storage/usage");
  return data;
}

export async function fetchNamespaces(): Promise<StorageNamespace[]> {
  const { data } = await apiV1.get<{ namespaces: StorageNamespace[] }>("/storage/namespaces");
  return data.namespaces;
}

export async function fetchNamespaceDetails(name: string): Promise<StorageNamespace> {
  const { data } = await apiV1.get<StorageNamespace>(`/storage/namespaces/${encodeURIComponent(name)}`);
  return data;
}

export async function createStorageNamespace(name: string): Promise<StorageNamespace> {
  const { data } = await apiV1.post<StorageNamespace>("/storage/namespaces", { name });
  return data;
}

export async function deleteStorageNamespace(name: string): Promise<void> {
  await apiV1.delete(`/storage/namespaces/${encodeURIComponent(name)}`);
}

export async function fetchFiles(
  namespace: string,
  options?: { prefix?: string; limit?: number }
): Promise<{ objects: StorageObject[]; prefixes: string[] }> {
  const params = new URLSearchParams();
  if (options?.prefix) params.set("prefix", options.prefix);
  if (options?.limit) params.set("limit", options.limit.toString());

  const url = `/storage/namespaces/${encodeURIComponent(namespace)}/files${
    params.toString() ? `?${params.toString()}` : ""
  }`;
  const { data } = await apiV1.get<{ objects: StorageObject[]; prefixes?: string[] }>(url);
  return {
    objects: data.objects || [],
    prefixes: data.prefixes || [],
  };
}

export async function uploadStorageFile(
  namespace: string,
  path: string,
  file: File | Blob,
  contentType?: string
): Promise<{ path: string; size: number; etag: string }> {
  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const resolvedContentType =
    contentType ||
    (file instanceof File && file.type ? file.type : "application/octet-stream");

  const response = await fetch(
    `/api/v1/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": resolvedContentType,
      },
      body: file,
    }
  );

  if (!response.ok) {
    let msg = `Upload failed (${response.status})`;
    try {
      const data = await response.json();
      if (data?.error?.message) {
        msg = data.error.message;
      }
    } catch {
      // Fallback
    }
    throw new Error(msg);
  }

  return (await response.json()) as { path: string; size: number; etag: string };
}

export async function downloadStorageFile(
  namespace: string,
  path: string,
  filename?: string
): Promise<void> {
  const cleanPath = path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  const response = await fetch(
    `/api/v1/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`
  );

  if (!response.ok) {
    let msg = `Download failed (${response.status})`;
    try {
      const data = await response.json();
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
    `/storage/namespaces/${encodeURIComponent(namespace)}/files/${encodedPath}`
  );
  return data;
}

export async function fetchApiKeys(): Promise<StorageApiKey[]> {
  const { data } = await apiV1.get<{ keys: StorageApiKey[] }>("/storage/api-keys");
  return data.keys;
}

export async function createStorageApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  const { data } = await apiV1.post<CreateApiKeyResult>("/storage/api-keys", input);
  return data;
}

export async function deleteStorageApiKey(keyId: string): Promise<void> {
  await apiV1.delete(`/storage/api-keys/${encodeURIComponent(keyId)}`);
}

/** Formats byte size into human readable string (e.g. 512 KB, 12.4 MB) */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
