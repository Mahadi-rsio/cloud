import { StorageApiError } from "./errors.js";
import {
  buildDownloadHeaders,
  buildUploadHeaders,
  createTransportConfig,
  encodeObjectPath,
  jsonRequest,
  rawRequest,
  throwIfErrorResponse,
  toDownloadResult,
  toHeadResult,
  type HttpTransportConfig,
} from "./http.js";
import type {
  CopyOptions,
  CopyResult,
  CreateApiKeyInput,
  CreateApiKeyResult,
  DeleteFileResult,
  DownloadOptions,
  DownloadResult,
  HeadOptions,
  HeadResult,
  ListOptions,
  ListResult,
  PresignMethod,
  PresignOptions,
  PresignResult,
  RequestOptions,
  StorageApiKey,
  StorageClientOptions,
  StorageNamespace,
  StorageNamespaceDetails,
  StorageObject,
  StorageUsageResult,
  TenantInfoResult,
  UploadBody,
  UploadOptions,
  UploadResult,
} from "./types.js";

function normalizeListArgs(
  prefixOrOptions?: string | ListOptions,
  maybeOptions?: ListOptions,
): ListOptions {
  if (typeof prefixOrOptions === "string") {
    return { ...maybeOptions, prefix: prefixOrOptions };
  }
  return prefixOrOptions ?? {};
}

function resolvePresignMethod(options?: PresignOptions): PresignMethod {
  if (options?.method) return options.method;
  if (options?.action === "read" || options?.action === "GET") return "GET";
  if (options?.action === "write" || options?.action === "PUT") return "PUT";
  return "PUT";
}

function resolvePresignedTarget(
  config: HttpTransportConfig,
  tokenOrUrl: string,
): string {
  const trimmed = tokenOrUrl.trim();
  if (!trimmed) {
    throw new Error("Presigned token or URL must be a non-empty string.");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("/api/v1/storage/presigned/")) {
    return config.originUrl ? `${config.originUrl}${trimmed}` : trimmed;
  }
  const token = trimmed.replace(/^\/+/, "");
  return `/presigned/${encodeURIComponent(token)}`;
}

/**
 * Scoped client for object operations within a single storage namespace.
 */
export class NamespaceClient {
  readonly name: string;
  private readonly config: HttpTransportConfig;

  constructor(config: HttpTransportConfig, namespaceName: string) {
    const trimmed = namespaceName.trim();
    if (!trimmed) {
      throw new Error("Namespace name must be a non-empty string.");
    }
    this.config = config;
    this.name = trimmed;
  }

  private get nsSegment(): string {
    return encodeURIComponent(this.name);
  }

  /**
   * Upload an object to `<namespace>/<path>` (max 100 MB).
   */
  async upload(
    path: string,
    body: UploadBody,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const encodedPath = encodeObjectPath(path);
    const headers = buildUploadHeaders(body, options);

    return jsonRequest<UploadResult>(this.config, {
      method: "PUT",
      path: `/namespaces/${this.nsSegment}/files/${encodedPath}`,
      headers,
      body: body as BodyInit,
      options,
    });
  }

  /**
   * Download an object from `<namespace>/<path>`.
   * Supports byte ranges (`range`) and conditional GET (`ifNoneMatch`, `ifModifiedSince`).
   */
  async download(path: string, options?: DownloadOptions): Promise<DownloadResult> {
    const encodedPath = encodeObjectPath(path);
    const headers = buildDownloadHeaders(options);

    const response = await rawRequest(this.config, {
      method: "GET",
      path: `/namespaces/${this.nsSegment}/files/${encodedPath}`,
      query: options?.download ? { download: "true" } : undefined,
      headers,
      options,
    });

    await throwIfErrorResponse(response);
    return toDownloadResult(response);
  }

  /**
   * Retrieve object metadata and ETag without downloading the body.
   */
  async head(path: string, options?: HeadOptions): Promise<HeadResult> {
    const encodedPath = encodeObjectPath(path);
    const headers = buildDownloadHeaders(options);

    const response = await rawRequest(this.config, {
      method: "HEAD",
      path: `/namespaces/${this.nsSegment}/files/${encodedPath}`,
      headers,
      options,
    });

    await throwIfErrorResponse(response);
    return toHeadResult(response);
  }

  /**
   * Check whether an object exists in the namespace (`false` on 404).
   */
  async exists(path: string, options?: RequestOptions): Promise<boolean> {
    try {
      await this.head(path, options);
      return true;
    } catch (error) {
      if (error instanceof StorageApiError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete an object from the namespace.
   */
  async delete(path: string, options?: RequestOptions): Promise<DeleteFileResult> {
    const encodedPath = encodeObjectPath(path);
    return jsonRequest<DeleteFileResult>(this.config, {
      method: "DELETE",
      path: `/namespaces/${this.nsSegment}/files/${encodedPath}`,
      options,
    });
  }

  /**
   * Copy an object to another path (optionally in another namespace).
   */
  async copy(
    sourcePath: string,
    destinationPath: string,
    options?: CopyOptions,
  ): Promise<CopyResult> {
    const encodedPath = encodeObjectPath(sourcePath);
    return jsonRequest<CopyResult>(this.config, {
      method: "POST",
      path: `/namespaces/${this.nsSegment}/files/${encodedPath}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationPath,
        ...(options?.destinationNamespace
          ? { destinationNamespace: options.destinationNamespace }
          : {}),
      }),
      options,
    });
  }

  /**
   * List objects in the namespace with optional prefix, delimiter, cursor, and limit.
   */
  async list(
    prefixOrOptions?: string | ListOptions,
    maybeOptions?: ListOptions,
  ): Promise<ListResult> {
    const opts = normalizeListArgs(prefixOrOptions, maybeOptions);
    const data = await jsonRequest<{
      namespace: string;
      objects: StorageObject[];
      prefixes?: string[];
      cursor?: string;
      truncated?: boolean;
    }>(this.config, {
      method: "GET",
      path: `/namespaces/${this.nsSegment}/files`,
      query: {
        prefix: opts.prefix,
        delimiter: opts.delimiter,
        cursor: opts.cursor,
        limit: opts.limit,
      },
      options: opts,
    });

    return {
      namespace: data.namespace,
      objects: Array.isArray(data.objects) ? data.objects : [],
      prefixes: Array.isArray(data.prefixes) ? data.prefixes : [],
      cursor: data.cursor,
      truncated: Boolean(data.truncated),
    };
  }

  /**
   * Async generator that automatically paginates through all matching objects.
   */
  async *listAll(
    prefixOrOptions?: string | ListOptions,
    maybeOptions?: ListOptions,
  ): AsyncIterableIterator<StorageObject> {
    const baseOpts = normalizeListArgs(prefixOrOptions, maybeOptions);
    let cursor = baseOpts.cursor;

    while (true) {
      const page = await this.list({ ...baseOpts, cursor });
      for (const obj of page.objects) {
        yield obj;
      }
      if (!page.truncated || !page.cursor) {
        break;
      }
      cursor = page.cursor;
    }
  }

  /**
   * Create a short-lived presigned upload (`PUT`) or download (`GET`) token & URL.
   */
  async createPresignedUrl(
    path: string,
    options?: PresignOptions,
  ): Promise<PresignResult> {
    const method = resolvePresignMethod(options);
    const raw = await jsonRequest<{
      token: string;
      url: string;
      method: PresignMethod;
      namespace: string;
      path: string;
      expiresIn: number;
      expiresAt: string;
    }>(this.config, {
      method: "POST",
      path: `/namespaces/${this.nsSegment}/presign`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        method,
        ...(options?.expiresIn !== undefined ? { expiresIn: options.expiresIn } : {}),
        ...(options?.contentType !== undefined
          ? { contentType: options.contentType }
          : {}),
        ...(options?.maxSizeBytes !== undefined
          ? { maxSizeBytes: options.maxSizeBytes }
          : {}),
        ...(options?.singleUse !== undefined ? { singleUse: options.singleUse } : {}),
      }),
      options,
    });

    const resolvedUrl =
      this.config.originUrl && raw.url.startsWith("/")
        ? `${this.config.originUrl}${raw.url}`
        : raw.url;

    return {
      ...raw,
      url: resolvedUrl,
      relativeUrl: raw.url,
    };
  }
}

/**
 * Manage storage namespaces (buckets) for the current tenant.
 */
export class NamespacesResource {
  private readonly config: HttpTransportConfig;

  constructor(config: HttpTransportConfig) {
    this.config = config;
  }

  async list(options?: RequestOptions): Promise<StorageNamespace[]> {
    const data = await jsonRequest<{
      tenantId: string;
      namespaces: StorageNamespace[];
    }>(this.config, {
      method: "GET",
      path: "/namespaces",
      options,
    });
    return Array.isArray(data.namespaces) ? data.namespaces : [];
  }

  async create(name: string, options?: RequestOptions): Promise<StorageNamespace> {
    return jsonRequest<StorageNamespace>(this.config, {
      method: "POST",
      path: "/namespaces",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      options,
    });
  }

  async get(
    name: string,
    options?: RequestOptions,
  ): Promise<StorageNamespaceDetails> {
    return jsonRequest<StorageNamespaceDetails>(this.config, {
      method: "GET",
      path: `/namespaces/${encodeURIComponent(name)}`,
      options,
    });
  }

  async delete(
    name: string,
    options?: RequestOptions,
  ): Promise<{ message: string }> {
    return jsonRequest<{ message: string }>(this.config, {
      method: "DELETE",
      path: `/namespaces/${encodeURIComponent(name)}`,
      options,
    });
  }
}

/**
 * Manage storage API keys for the current tenant.
 */
export class ApiKeysResource {
  private readonly config: HttpTransportConfig;

  constructor(config: HttpTransportConfig) {
    this.config = config;
  }

  async list(options?: RequestOptions): Promise<StorageApiKey[]> {
    const data = await jsonRequest<{ keys: StorageApiKey[] }>(this.config, {
      method: "GET",
      path: "/api-keys",
      options,
    });
    return Array.isArray(data.keys) ? data.keys : [];
  }

  async create(
    input: CreateApiKeyInput,
    options?: RequestOptions,
  ): Promise<CreateApiKeyResult> {
    return jsonRequest<CreateApiKeyResult>(this.config, {
      method: "POST",
      path: "/api-keys",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      options,
    });
  }

  async revoke(keyId: string, options?: RequestOptions): Promise<{ message: string }> {
    return jsonRequest<{ message: string }>(this.config, {
      method: "DELETE",
      path: `/api-keys/${encodeURIComponent(keyId)}`,
      options,
    });
  }
}

/**
 * Execute direct presigned uploads and downloads without sending an API key.
 */
export class PresignedResource {
  private readonly config: HttpTransportConfig;

  constructor(config: HttpTransportConfig) {
    this.config = config;
  }

  async upload(
    tokenOrUrl: string,
    body: UploadBody,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const target = resolvePresignedTarget(this.config, tokenOrUrl);
    const headers = buildUploadHeaders(body, options);

    return jsonRequest<UploadResult>(this.config, {
      method: "PUT",
      path: target,
      headers,
      body: body as BodyInit,
      skipAuth: true,
      options,
    });
  }

  async download(
    tokenOrUrl: string,
    options?: DownloadOptions,
  ): Promise<DownloadResult> {
    const target = resolvePresignedTarget(this.config, tokenOrUrl);
    const headers = buildDownloadHeaders(options);

    const response = await rawRequest(this.config, {
      method: "GET",
      path: target,
      query: options?.download ? { download: "true" } : undefined,
      headers,
      skipAuth: true,
      options,
    });

    await throwIfErrorResponse(response);
    return toDownloadResult(response);
  }
}

/**
 * Top-level client for the Cloud Object Storage API.
 */
export class StorageClient {
  private readonly config: HttpTransportConfig;
  private readonly defaultNamespace?: string;

  readonly namespaces: NamespacesResource;
  readonly apiKeys: ApiKeysResource;
  readonly presigned: PresignedResource;

  constructor(options: StorageClientOptions = {}) {
    this.config = createTransportConfig(options);
    this.defaultNamespace = options.namespace?.trim() || undefined;
    this.namespaces = new NamespacesResource(this.config);
    this.apiKeys = new ApiKeysResource(this.config);
    this.presigned = new PresignedResource(this.config);
  }

  /**
   * Get a scoped client for a specific namespace.
   */
  namespace(name: string): NamespaceClient {
    return new NamespaceClient(this.config, name);
  }

  /**
   * Shorthand alias for `namespace(name)`.
   */
  ns(name: string): NamespaceClient {
    return this.namespace(name);
  }

  private requireDefaultNamespace(): NamespaceClient {
    if (!this.defaultNamespace) {
      throw new Error(
        "No default namespace configured. Pass `namespace` in StorageClientOptions or call `client.namespace(name)`.",
      );
    }
    return this.namespace(this.defaultNamespace);
  }

  /**
   * Get current storage usage, operation counts, and plan quota limits.
   */
  async getUsage(options?: RequestOptions): Promise<StorageUsageResult> {
    return jsonRequest<StorageUsageResult>(this.config, {
      method: "GET",
      path: "/usage",
      options,
    });
  }

  /**
   * Get current tenant metadata, plan limits, and usage.
   */
  async getTenant(options?: RequestOptions): Promise<TenantInfoResult> {
    return jsonRequest<TenantInfoResult>(this.config, {
      method: "GET",
      path: "/tenants",
      options,
    });
  }

  // Top-level convenience methods delegating to `options.namespace`

  upload(path: string, body: UploadBody, options?: UploadOptions): Promise<UploadResult> {
    return this.requireDefaultNamespace().upload(path, body, options);
  }

  download(path: string, options?: DownloadOptions): Promise<DownloadResult> {
    return this.requireDefaultNamespace().download(path, options);
  }

  head(path: string, options?: HeadOptions): Promise<HeadResult> {
    return this.requireDefaultNamespace().head(path, options);
  }

  exists(path: string, options?: RequestOptions): Promise<boolean> {
    return this.requireDefaultNamespace().exists(path, options);
  }

  delete(path: string, options?: RequestOptions): Promise<DeleteFileResult> {
    return this.requireDefaultNamespace().delete(path, options);
  }

  copy(
    sourcePath: string,
    destinationPath: string,
    options?: CopyOptions,
  ): Promise<CopyResult> {
    return this.requireDefaultNamespace().copy(sourcePath, destinationPath, options);
  }

  list(
    prefixOrOptions?: string | ListOptions,
    maybeOptions?: ListOptions,
  ): Promise<ListResult> {
    return this.requireDefaultNamespace().list(prefixOrOptions, maybeOptions);
  }

  listAll(
    prefixOrOptions?: string | ListOptions,
    maybeOptions?: ListOptions,
  ): AsyncIterableIterator<StorageObject> {
    return this.requireDefaultNamespace().listAll(prefixOrOptions, maybeOptions);
  }

  createPresignedUrl(
    path: string,
    options?: PresignOptions,
  ): Promise<PresignResult> {
    return this.requireDefaultNamespace().createPresignedUrl(path, options);
  }
}

/**
 * Create a new `StorageClient` instance.
 */
export function createStorageClient(options: StorageClientOptions = {}): StorageClient {
  return new StorageClient(options);
}
