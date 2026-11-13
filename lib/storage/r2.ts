export interface StoredObjectMetadata {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
  uploaded: Date;
}

export interface StoredObjectBody extends StoredObjectMetadata {
  body: ReadableStream<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export interface ListObjectsOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

export interface ListObjectsResult {
  objects: StoredObjectMetadata[];
  delimitedPrefixes: string[];
  cursor?: string;
  truncated: boolean;
}

export interface PutObjectOptions {
  httpMetadata?: {
    contentType?: string;
    contentLanguage?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string>;
  sha256?: string;
}

export interface StorageBucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string | Blob,
    options?: PutObjectOptions,
  ): Promise<StoredObjectMetadata>;
  get(key: string, options?: { range?: { offset?: number; length?: number } }): Promise<StoredObjectBody | null>;
  head(key: string): Promise<StoredObjectMetadata | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: ListObjectsOptions): Promise<ListObjectsResult>;
  /**
   * Returns a presigned URL that allows the caller to perform the specified
   * HTTP method on `key` without further authentication.
   *
   * For the real Cloudflare R2 binding (private bucket), presigned URLs are
   * not directly available from Workers bindings without public access enabled
   * on the bucket.  Callers should use the internal proxy-token approach
   * (`/api/v1/storage/presigned/[token]`) instead.  Implementations MAY
   * return a stub URL in environments where true presigned URLs are unavailable.
   */
  presign(key: string, options: { method: "GET" | "PUT"; expiresIn: number }): Promise<string>;
}

/**
 * In-memory R2-compatible storage provider for local dev and automated tests.
 */
export class MemoryStorageBucket implements StorageBucket {
  private store = new Map<
    string,
    {
      data: Uint8Array;
      metadata: StoredObjectMetadata;
    }
  >();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array | string | Blob,
    options?: PutObjectOptions,
  ): Promise<StoredObjectMetadata> {
    let bytes: Uint8Array;

    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (typeof Blob !== "undefined" && value instanceof Blob) {
      bytes = new Uint8Array(await value.arrayBuffer());
    } else if (value && typeof (value as ReadableStream).getReader === "function") {
      const reader = (value as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        if (chunk) {
          chunks.push(chunk);
          totalLength += chunk.length;
        }
      }
      bytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      throw new Error("Unsupported value type for storage put");
    }

    const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
    const etag = `"${Array.from(new Uint8Array(digest))
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}"`;

    const metadata: StoredObjectMetadata = {
      key,
      size: bytes.byteLength,
      etag,
      httpMetadata: options?.httpMetadata ?? { contentType: "application/octet-stream" },
      customMetadata: options?.customMetadata ?? {},
      uploaded: new Date(),
    };

    this.store.set(key, { data: bytes, metadata });
    return metadata;
  }

  async get(
    key: string,
    options?: { range?: { offset?: number; length?: number } },
  ): Promise<StoredObjectBody | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    let data = entry.data;
    if (options?.range) {
      const offset = options.range.offset ?? 0;
      const length = options.range.length ?? data.length - offset;
      data = data.slice(offset, offset + length);
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });

    return {
      ...entry.metadata,
      size: data.byteLength,
      body: stream,
      async arrayBuffer(): Promise<ArrayBuffer> {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      },
      async text() {
        return new TextDecoder().decode(data);
      },
      async json<T = unknown>() {
        return JSON.parse(new TextDecoder().decode(data)) as T;
      },
    };
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const entry = this.store.get(key);
    return entry ? entry.metadata : null;
  }

  async delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      this.store.delete(key);
    }
  }

  async list(options?: ListObjectsOptions): Promise<ListObjectsResult> {
    const prefix = options?.prefix ?? "";
    const delimiter = options?.delimiter;
    const limit = Math.max(1, options?.limit ?? 1000);
    const cursorKey = options?.cursor;

    const objects: StoredObjectMetadata[] = [];
    const delimitedPrefixes = new Set<string>();

    const allKeys = Array.from(this.store.keys()).sort();
    let truncated = false;
    let lastIncludedKey: string | undefined;

    for (const key of allKeys) {
      if (!key.startsWith(prefix)) continue;
      if (cursorKey && key <= cursorKey) continue;

      if (delimiter) {
        const remaining = key.slice(prefix.length);
        const delimiterIdx = remaining.indexOf(delimiter);
        if (delimiterIdx !== -1) {
          delimitedPrefixes.add(prefix + remaining.slice(0, delimiterIdx + delimiter.length));
          continue;
        }
      }

      if (objects.length >= limit) {
        truncated = true;
        break;
      }

      const item = this.store.get(key);
      if (item) {
        objects.push(item.metadata);
        lastIncludedKey = key;
      }
    }

    return {
      objects,
      delimitedPrefixes: Array.from(delimitedPrefixes),
      cursor: truncated ? lastIncludedKey : undefined,
      truncated,
    };
  }

  // TODO: MemoryStorageBucket stub — real presigned URLs are not applicable in
  // local/test environments.  Returns a deterministic stub URL for testing.
  async presign(key: string, _options: { method: "GET" | "PUT"; expiresIn: number }): Promise<string> {
    return "http://localhost/presigned-stub?key=" + encodeURIComponent(key);
  }

  clear() {
    this.store.clear();
  }
}

let fallbackBucket: MemoryStorageBucket | undefined;

/**
 * Retrieves the active R2 StorageBucket from Cloudflare Workers environment or memory fallback.
 */
export async function getStorageBucket(): Promise<StorageBucket> {
  try {
    const { env } = await import("cloudflare:workers");
    const r2 = (env as unknown as Record<string, unknown>).STORAGE_BUCKET as StorageBucket | undefined;
    if (r2 && typeof r2.put === "function" && typeof r2.get === "function") {
      // Cloudflare R2 private buckets do not expose a createPresignedUrl method
      // from Workers bindings without public access enabled.  We attach a stub
      // that documents this limitation; callers should use the internal proxy-token
      // approach (/api/v1/storage/presigned/[token]) for authenticated uploads.
      if (typeof (r2 as unknown as Record<string, unknown>).presign !== "function") {
        (r2 as unknown as Record<string, unknown>).presign = async (
          key: string,
          _options: { method: "GET" | "PUT"; expiresIn: number },
        ) => {
          // NOTE: Real presigned URLs require a public R2 bucket with a custom
          // domain configured in the Cloudflare dashboard.  This stub is
          // intentionally returned so callers degrade gracefully.
          return "https://your-public-r2-domain/presigned-stub?key=" + encodeURIComponent(key);
        };
      }
      return r2;
    }
  } catch {
    // Cloudflare Workers environment not available (local node / tests)
  }

  if (!fallbackBucket) {
    fallbackBucket = new MemoryStorageBucket();
  }
  return fallbackBucket;
}

/**
 * Resets memory bucket (for testing).
 */
export function resetMemoryStorageBucket(): void {
  fallbackBucket?.clear();
  fallbackBucket = undefined;
}
