import { parseRateLimitHeaders, StorageApiError } from "./errors.js";
import type {
  AuthHeaderStyle,
  DownloadOptions,
  DownloadResult,
  HeadOptions,
  HeadResult,
  RequestOptions,
  StorageClientOptions,
  UploadBody,
  UploadOptions,
} from "./types.js";

const API_PREFIX = "/api/v1/storage";

export function normalizeApiBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return API_PREFIX;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return API_PREFIX;
  if (trimmed.endsWith(API_PREFIX)) return trimmed;
  return `${trimmed}${API_PREFIX}`;
}

export function resolveOriginFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "";
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.endsWith(API_PREFIX)) {
    return trimmed.slice(0, -API_PREFIX.length);
  }
  return trimmed;
}

export function encodeObjectPath(path: string): string {
  const cleaned = path.replace(/^\/+/, "");
  if (!cleaned) {
    throw new Error("Object path must be a non-empty string.");
  }
  return cleaned
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export interface HttpTransportConfig {
  apiBaseUrl: string;
  originUrl: string;
  apiKey?: string;
  authHeader: AuthHeaderStyle;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
  fetchFn: typeof globalThis.fetch;
}

export function createTransportConfig(options: StorageClientOptions): HttpTransportConfig {
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error(
      "No fetch implementation available. Pass `fetch` in StorageClientOptions or use Node 18+.",
    );
  }

  return {
    apiBaseUrl: normalizeApiBaseUrl(options.baseUrl),
    originUrl: resolveOriginFromBaseUrl(options.baseUrl),
    apiKey: options.apiKey,
    authHeader: options.authHeader ?? "x-api-key",
    timeoutMs: options.timeoutMs,
    defaultHeaders: options.headers,
    fetchFn,
  };
}

interface InternalRequestInit {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string | undefined>;
  body?: BodyInit | null;
  skipAuth?: boolean;
  options?: RequestOptions;
}

function buildSignal(
  config: HttpTransportConfig,
  options?: RequestOptions,
): { signal?: AbortSignal; cleanup: () => void } {
  const timeoutMs = options?.timeoutMs ?? config.timeoutMs;
  const userSignal = options?.signal;

  if (!timeoutMs && !userSignal) {
    return { signal: undefined, cleanup: () => {} };
  }

  if (timeoutMs && timeoutMs > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onUserAbort = () => controller.abort(userSignal?.reason);
    if (userSignal) {
      if (userSignal.aborted) {
        clearTimeout(timer);
        controller.abort(userSignal.reason);
      } else {
        userSignal.addEventListener("abort", onUserAbort, { once: true });
      }
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        userSignal?.removeEventListener("abort", onUserAbort);
      },
    };
  }

  return { signal: userSignal, cleanup: () => {} };
}

export async function rawRequest(
  config: HttpTransportConfig,
  init: InternalRequestInit,
): Promise<Response> {
  const qs = new URLSearchParams();
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") {
        qs.set(k, String(v));
      }
    }
  }
  const queryString = qs.toString();
  const base = init.path.startsWith("http://") || init.path.startsWith("https://")
    ? init.path
    : `${config.apiBaseUrl}${init.path.startsWith("/") ? init.path : `/${init.path}`}`;
  const url = queryString ? `${base}${base.includes("?") ? "&" : "?"}${queryString}` : base;

  const headers = new Headers();
  if (!init.skipAuth) {
    if (config.defaultHeaders) {
      for (const [k, v] of Object.entries(config.defaultHeaders)) {
        headers.set(k, v);
      }
    }
    if (config.apiKey) {
      if (config.authHeader === "bearer") {
        headers.set("Authorization", `Bearer ${config.apiKey}`);
      } else {
        headers.set("x-api-key", config.apiKey);
      }
    }
  }

  if (init.options?.headers) {
    for (const [k, v] of Object.entries(init.options.headers)) {
      headers.set(k, v);
    }
  }
  if (init.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      if (v !== undefined) {
        headers.set(k, v);
      }
    }
  }

  const { signal, cleanup } = buildSignal(config, init.options);
  try {
    const fetchInit: RequestInit & { duplex?: "half" } = {
      method: init.method,
      headers,
      body: init.body,
      signal,
    };

    // Node.js native fetch requires `duplex: "half"` when sending a ReadableStream body
    if (
      init.body &&
      typeof ReadableStream !== "undefined" &&
      init.body instanceof ReadableStream
    ) {
      fetchInit.duplex = "half";
    }

    return await config.fetchFn(url, fetchInit);
  } finally {
    cleanup();
  }
}

export async function throwIfErrorResponse(response: Response): Promise<void> {
  if (response.ok || response.status === 304) return;

  const rateLimit = parseRateLimitHeaders(response.headers);
  let code = `HTTP_${response.status}`;
  let message = response.statusText || `Request failed with status ${response.status}`;
  let details: unknown;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string; details?: unknown };
        message?: string;
      };
      if (payload?.error) {
        if (payload.error.code) code = payload.error.code;
        if (payload.error.message) message = payload.error.message;
        if (payload.error.details !== undefined) details = payload.error.details;
      } else if (payload?.message) {
        message = payload.message;
      }
    } catch {
      // Fallback to default message
    }
  } else {
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
      // Fallback to default message
    }
  }

  throw new StorageApiError({
    status: response.status,
    code,
    message,
    details,
    rateLimit,
  });
}

export async function jsonRequest<T>(
  config: HttpTransportConfig,
  init: InternalRequestInit,
): Promise<T> {
  const response = await rawRequest(config, init);
  await throwIfErrorResponse(response);
  const envelope = (await response.json()) as { success: boolean; data: T };
  return envelope.data;
}

export function buildUploadHeaders(
  body: UploadBody,
  options?: UploadOptions,
): Record<string, string | undefined> {
  let contentType = options?.contentType;
  if (!contentType && typeof File !== "undefined" && body instanceof File && body.type) {
    contentType = body.type;
  }
  if (!contentType && typeof Blob !== "undefined" && body instanceof Blob && body.type) {
    contentType = body.type;
  }

  const headers: Record<string, string | undefined> = {
    "Content-Type": contentType || "application/octet-stream",
    "Cache-Control": options?.cacheControl,
    "Idempotency-Key": options?.idempotencyKey,
    "Content-Length":
      options?.contentLength !== undefined ? String(options.contentLength) : undefined,
  };

  if (options?.metadata) {
    for (const [k, v] of Object.entries(options.metadata)) {
      headers[`x-storage-meta-${k}`] = v;
    }
  }

  return headers;
}

export function buildDownloadHeaders(
  options?: DownloadOptions | HeadOptions,
): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  if (!options) return headers;

  if (options.ifNoneMatch) {
    headers["If-None-Match"] = options.ifNoneMatch;
  }
  if (options.ifModifiedSince) {
    headers["If-Modified-Since"] =
      options.ifModifiedSince instanceof Date
        ? options.ifModifiedSince.toUTCString()
        : options.ifModifiedSince;
  }

  if ("range" in options && options.range !== undefined) {
    if (typeof options.range === "string") {
      headers["Range"] = options.range;
    } else {
      const endPart = options.range.end !== undefined ? String(options.range.end) : "";
      headers["Range"] = `bytes=${options.range.start}-${endPart}`;
    }
  }

  return headers;
}

export function toDownloadResult(response: Response): DownloadResult {
  const status = response.status as 200 | 206 | 304;
  const contentLengthHeader = response.headers.get("content-length");
  const parsedLength =
    contentLengthHeader !== null ? Number(contentLengthHeader) : null;
  const lastModifiedHeader = response.headers.get("last-modified");
  const parsedLastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;

  return {
    status,
    notModified: status === 304,
    body: response.body,
    etag: response.headers.get("etag"),
    contentType: response.headers.get("content-type"),
    contentLength:
      parsedLength !== null && Number.isFinite(parsedLength) ? parsedLength : null,
    lastModified:
      parsedLastModified && !Number.isNaN(parsedLastModified.getTime())
        ? parsedLastModified
        : null,
    contentRange: response.headers.get("content-range"),
    headers: response.headers,
    arrayBuffer: () => response.arrayBuffer(),
    bytes: async () => new Uint8Array(await response.arrayBuffer()),
    text: () => response.text(),
    json: <T = unknown>() => response.json() as Promise<T>,
    blob: () => response.blob(),
  };
}

export function toHeadResult(response: Response): HeadResult {
  const status = response.status as 200 | 304;
  const contentLengthHeader = response.headers.get("content-length");
  const parsedLength =
    contentLengthHeader !== null ? Number(contentLengthHeader) : null;
  const lastModifiedHeader = response.headers.get("last-modified");
  const parsedLastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;

  return {
    status,
    notModified: status === 304,
    etag: response.headers.get("etag"),
    contentType: response.headers.get("content-type"),
    contentLength:
      parsedLength !== null && Number.isFinite(parsedLength) ? parsedLength : null,
    lastModified:
      parsedLastModified && !Number.isNaN(parsedLastModified.getTime())
        ? parsedLastModified
        : null,
    acceptRanges: response.headers.get("accept-ranges"),
    headers: response.headers,
  };
}
