/**
 * Typed Cloudflare Workers KV abstraction with:
 * - Bounded isolate-local hot cache (L1) + Workers KV (L2)
 * - In-flight stampede coalescing for concurrent cache misses
 * - Mandatory minimum 60s expirationTtl enforcement (Cloudflare KV requirement)
 * - Cache key versioning & graceful failure handling
 * - Deterministic in-memory fallback for local dev and Vitest
 */

export const KV_MIN_TTL_SECONDS = 60;
const DEFAULT_L1_MAX_ENTRIES = 2000;

export interface KVNamespaceLike {
  get(key: string, type?: "text" | "json"): Promise<unknown>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface MemoryEntry {
  value: string;
  expiresAtMs: number;
}

const l1Cache = new Map<string, MemoryEntry>();
const fallbackKvStore = new Map<string, MemoryEntry>();
const inflightLoads = new Map<string, Promise<unknown>>();

function normalizeTtlSeconds(ttlSeconds: number): number {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < KV_MIN_TTL_SECONDS) {
    return KV_MIN_TTL_SECONDS;
  }
  return Math.floor(ttlSeconds);
}

function setBoundedL1(
  store: Map<string, MemoryEntry>,
  key: string,
  value: string,
  ttlMs: number,
  maxEntries = DEFAULT_L1_MAX_ENTRIES,
): void {
  const now = Date.now();
  if (store.size >= maxEntries && !store.has(key)) {
    // Prune expired entries first; if still full, evict oldest inserted key
    for (const [k, entry] of store) {
      if (entry.expiresAtMs <= now) {
        store.delete(k);
      }
      if (store.size < maxEntries) break;
    }
    if (store.size >= maxEntries) {
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) {
        store.delete(oldestKey);
      }
    }
  }
  // Refresh insertion order
  store.delete(key);
  store.set(key, { value, expiresAtMs: now + ttlMs });
}

function getFromMemory(
  store: Map<string, MemoryEntry>,
  key: string,
): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

async function resolveCfKv(): Promise<KVNamespaceLike | null> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return null;
  }
  try {
    const { env } = await import("cloudflare:workers");
    const kv = (env as unknown as Record<string, unknown>)?.APP_KV as
      | KVNamespaceLike
      | undefined;
    if (kv && typeof kv.get === "function" && typeof kv.put === "function") {
      return kv;
    }
  } catch {
    // Not running in Cloudflare Workers
  }
  return null;
}

export interface KvCacheOptions {
  /** KV TTL in seconds (clamped to >= 60s per Cloudflare KV limits). */
  kvTtlSeconds?: number;
  /** Isolate-local L1 memory TTL in milliseconds. Set 0 to skip L1. */
  l1TtlMs?: number;
  /** Cache version tag included in the key. */
  version?: string;
}

export class TypedKvCache {
  private readonly prefix: string;
  private readonly version: string;

  constructor(prefix: string, version = "v1") {
    this.prefix = prefix;
    this.version = version;
  }

  key(rawKey: string, versionOverride?: string): string {
    const ver = versionOverride ?? this.version;
    return `${this.prefix}:${ver}:${rawKey}`;
  }

  async getJson<T>(
    rawKey: string,
    options?: Pick<KvCacheOptions, "l1TtlMs" | "version">,
  ): Promise<T | null> {
    const fullKey = this.key(rawKey, options?.version);
    const useL1 = (options?.l1TtlMs ?? 15_000) > 0;

    if (useL1) {
      const l1Raw = getFromMemory(l1Cache, fullKey);
      if (l1Raw !== null) {
        try {
          return JSON.parse(l1Raw) as T;
        } catch {
          l1Cache.delete(fullKey);
        }
      }
    }

    const kv = await resolveCfKv();
    if (!kv) {
      const fallbackRaw = getFromMemory(fallbackKvStore, fullKey);
      if (fallbackRaw === null) return null;
      try {
        const parsed = JSON.parse(fallbackRaw) as T;
        if (useL1) {
          setBoundedL1(l1Cache, fullKey, fallbackRaw, options?.l1TtlMs ?? 15_000);
        }
        return parsed;
      } catch {
        fallbackKvStore.delete(fullKey);
        return null;
      }
    }

    try {
      const raw = await kv.get(fullKey, "text");
      if (typeof raw !== "string" || !raw) return null;
      const parsed = JSON.parse(raw) as T;
      if (useL1) {
        setBoundedL1(l1Cache, fullKey, raw, options?.l1TtlMs ?? 15_000);
      }
      return parsed;
    } catch {
      // Graceful KV degradation: treat as cache miss
      return null;
    }
  }

  async setJson<T>(
    rawKey: string,
    value: T,
    options?: KvCacheOptions,
  ): Promise<void> {
    const fullKey = this.key(rawKey, options?.version);
    const ttlSeconds = normalizeTtlSeconds(options?.kvTtlSeconds ?? 60);
    const l1TtlMs = options?.l1TtlMs ?? 15_000;
    const serialized = JSON.stringify(value);

    if (l1TtlMs > 0) {
      setBoundedL1(l1Cache, fullKey, serialized, l1TtlMs);
    }

    const kv = await resolveCfKv();
    if (!kv) {
      setBoundedL1(fallbackKvStore, fullKey, serialized, ttlSeconds * 1000, 10_000);
      return;
    }

    try {
      await kv.put(fullKey, serialized, { expirationTtl: ttlSeconds });
    } catch {
      // Non-blocking: KV write failure must not break requests
    }
  }

  async delete(rawKey: string, versionOverride?: string): Promise<void> {
    const fullKey = this.key(rawKey, versionOverride);
    l1Cache.delete(fullKey);
    fallbackKvStore.delete(fullKey);

    const kv = await resolveCfKv();
    if (!kv) return;
    try {
      await kv.delete(fullKey);
    } catch {
      // Non-blocking
    }
  }

  /**
   * Read-through helper with per-isolate stampede coalescing.
   * Concurrent callers for the same key share a single origin load.
   */
  async getOrLoad<T>(
    rawKey: string,
    loader: () => Promise<T | null>,
    options?: KvCacheOptions,
  ): Promise<T | null> {
    const cached = await this.getJson<T>(rawKey, options);
    if (cached !== null) return cached;

    const fullKey = this.key(rawKey, options?.version);
    const existingLoad = inflightLoads.get(fullKey) as Promise<T | null> | undefined;
    if (existingLoad) {
      return existingLoad;
    }

    const loadPromise = (async () => {
      try {
        const loaded = await loader();
        if (loaded !== null) {
          await this.setJson(rawKey, loaded, options);
        }
        return loaded;
      } finally {
        inflightLoads.delete(fullKey);
      }
    })();

    inflightLoads.set(fullKey, loadPromise);
    return loadPromise;
  }
}

export function resetAppKv(): void {
  l1Cache.clear();
  fallbackKvStore.clear();
  inflightLoads.clear();
}
