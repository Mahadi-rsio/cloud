export type StorageScope =
  | "storage:read"
  | "storage:write"
  | "storage:delete"
  | "storage:admin"
  | (string & {});

export type AuthHeaderStyle = "x-api-key" | "bearer";

export interface StorageClientOptions {
  /**
   * Base URL of the Cloud Storage service, e.g. `"https://cloud.rsioex.workers.dev"`.
   * May optionally include `"/api/v1/storage"`. Omit or pass `""` for relative requests in a browser.
   */
  baseUrl?: string;
  /**
   * Better Auth storage API key (`sk_live_...` or `sk_test_...`).
   * Optional when using session cookies in a browser or custom auth headers.
   */
  apiKey?: string;
  /**
   * Header used to send `apiKey`. Defaults to `"x-api-key"`.
   */
  authHeader?: AuthHeaderStyle;
  /**
   * Optional default namespace so you can call `client.upload(...)`, `client.download(...)`, etc. directly.
   */
  namespace?: string;
  /**
   * Default request timeout in milliseconds.
   */
  timeoutMs?: number;
  /**
   * Additional default headers sent on every authenticated request.
   */
  headers?: Record<string, string>;
  /**
   * Custom `fetch` implementation (useful for testing or custom runtimes).
   */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfterSeconds?: number;
}

export interface StorageLimits {
  storageLimitBytes: number;
  monthlyReadLimitOps: number;
  monthlyWriteLimitOps: number;
  bandwidthLimitBytes?: number | null;
  egressRateLimitMbps?: number | null;
}

export interface StorageUsageMetrics {
  usedBytes: number;
  fileCount: number;
  monthlyReadOps: number;
  monthlyWriteOps: number;
  peakDailyBytes?: number;
}

export interface StorageUsageResult {
  tenantId: string;
  plan: string;
  limits: StorageLimits;
  usage: StorageUsageMetrics;
}

export interface StorageTenant {
  id: string;
  name: string;
  status: string;
  plan: string;
  storageLimitBytes: number;
  monthlyReadLimitOps: number;
  monthlyWriteLimitOps: number;
  bandwidthLimitBytes?: number | null;
  egressRateLimitMbps?: number | null;
  trialEndsAt?: string | null;
  createdAt: string;
}

export interface TenantInfoResult {
  tenant: StorageTenant;
  usage: StorageUsageMetrics;
}

export interface StorageNamespace {
  id: string;
  name: string;
  tenantId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface StorageNamespaceDetails extends StorageNamespace {
  objectCount: number;
  totalBytes: number;
}

export interface StorageObject {
  path: string;
  key: string;
  name: string;
  size: number;
  etag: string;
  uploaded: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

export interface ListOptions extends RequestOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

export interface ListResult {
  namespace: string;
  objects: StorageObject[];
  prefixes: string[];
  cursor?: string;
  truncated: boolean;
}

export type UploadBody =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | string
  | ReadableStream<Uint8Array>;

export interface UploadOptions extends RequestOptions {
  contentType?: string;
  cacheControl?: string;
  contentLength?: number;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  namespace: string;
  path: string;
  size: number;
  etag: string;
  uploadedAt: string;
}

export interface DownloadOptions extends RequestOptions {
  /** Conditional GET: return `notModified: true` (304) if ETag matches. */
  ifNoneMatch?: string;
  /** Conditional GET: return `notModified: true` (304) if not modified since date. */
  ifModifiedSince?: Date | string;
  /** Byte range request, e.g. `"bytes=0-1023"` or `{ start: 0, end: 1023 }`. */
  range?: string | { start: number; end?: number };
  /** Force `Content-Disposition: attachment` on server response. */
  download?: boolean;
}

export interface DownloadResult {
  status: 200 | 206 | 304;
  notModified: boolean;
  body: ReadableStream<Uint8Array> | null;
  etag: string | null;
  contentType: string | null;
  contentLength: number | null;
  lastModified: Date | null;
  contentRange: string | null;
  headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface HeadOptions extends RequestOptions {
  ifNoneMatch?: string;
  ifModifiedSince?: Date | string;
}

export interface HeadResult {
  status: 200 | 304;
  notModified: boolean;
  etag: string | null;
  contentType: string | null;
  contentLength: number | null;
  lastModified: Date | null;
  acceptRanges: string | null;
  headers: Headers;
}

export interface DeleteFileResult {
  success: boolean;
  existed: boolean;
  namespace: string;
  path: string;
}

export interface CopyOptions extends RequestOptions {
  destinationNamespace?: string;
}

export interface CopyResult {
  sourcePath: string;
  destinationPath: string;
  destinationNamespace: string;
  size: number;
  etag: string;
}

export type PresignMethod = "GET" | "PUT";
export type PresignAction = "read" | "write" | PresignMethod;

export interface PresignOptions extends RequestOptions {
  /** HTTP method (`"GET"` or `"PUT"`). Defaults to `"PUT"`. */
  method?: PresignMethod;
  /** Alias for `method`: `"read"` maps to `"GET"`, `"write"` maps to `"PUT"`. */
  action?: PresignAction;
  /** Expiration in seconds (60..86400). Server defaults to 3600. */
  expiresIn?: number;
  /** Optional Content-Type constraint enforced on presigned PUT. */
  contentType?: string;
  /** Optional max upload size in bytes enforced on presigned PUT. */
  maxSizeBytes?: number;
  /** Whether the presigned token can only be used once. */
  singleUse?: boolean;
}

export interface PresignResult {
  token: string;
  /** Resolved URL (full URL when `baseUrl` is configured, or relative `/api/v1/storage/presigned/...`). */
  url: string;
  /** Raw relative path returned by the API. */
  relativeUrl: string;
  method: PresignMethod;
  namespace: string;
  path: string;
  expiresIn: number;
  expiresAt: string;
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
  scopes?: StorageScope[] | string;
  expiresInDays?: number;
  expiresAt?: string | null;
}

export interface CreateApiKeyResult {
  apiKey: StorageApiKey;
  secretKey: string;
}
