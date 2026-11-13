import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";
import { TypedKvCache } from "@/lib/kv";
import {
  extractApiKey,
  hashApiKey,
  hasScope,
  parseScopes,
  validateStorageScopes,
  type StorageScope,
} from "./auth";
import { getStorageDb } from "./db";
import { getStorageService } from "./service";
import { apiKeys, type ApiKey, type Project, type Tenant } from "./schema";

export interface StorageAuthContext {
  tenant: Tenant;
  user?: { id: string; email?: string; name?: string };
  project?: Project | null;
  apiKey?: ApiKey;
  scopes: StorageScope[];
}

export interface AuthenticateStorageOptions {
  namespace?: string;
  allowMasterWriteDeleteForAdmin?: boolean;
  /** Force authoritative DB validation, bypassing L1/KV caches. */
  forceFreshValidation?: boolean;
}

interface CachedApiKeyEntry {
  version: "v1";
  tenant: Tenant;
  apiKey: ApiKey;
  project?: Project | null;
  scopes: StorageScope[];
  cachedAt: number;
}

const MAX_MEMORY_CACHE_ENTRIES = 2000;
const CACHE_TTL_MS = 30_000;
const KV_CACHE_TTL_SECONDS = 60;
const REVOKED_TTL_MS = 3_600_000;
const LAST_USED_THROTTLE_MS = 5 * 60_000;

const apiKeyKv = new TypedKvCache("storage:apikey", "v1");
const revokedKeyKv = new TypedKvCache("storage:apikey-revoked", "v1");

const MEMORY_KEY_CACHE = new Map<string, CachedApiKeyEntry>();
const REVOKED_KEY_HASHES = new Map<string, number>();
const REVOKED_KEY_IDS = new Map<string, number>();
const LAST_USED_AT_MAP = new Map<string, number>();
const inflightAuthLookups = new Map<string, Promise<CachedApiKeyEntry | null>>();

function setBoundedEntry<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  maxSize = MAX_MEMORY_CACHE_ENTRIES,
): void {
  if (map.size >= maxSize && !map.has(key)) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.delete(key);
  map.set(key, value);
}

function pruneRevokedMaps(): void {
  const cutoff = Date.now() - REVOKED_TTL_MS;
  for (const [k, ts] of REVOKED_KEY_HASHES) {
    if (ts < cutoff) REVOKED_KEY_HASHES.delete(k);
  }
  for (const [k, ts] of REVOKED_KEY_IDS) {
    if (ts < cutoff) REVOKED_KEY_IDS.delete(k);
  }
}

/**
 * Centralized API-key cache invalidation.
 * Immediately invalidates isolate memory and KV cache entries and records
 * a revocation tombstone so stale cache entries cannot authorize requests.
 */
export async function invalidateApiKeyCache(params: {
  keyId?: string;
  keyHash?: string;
}): Promise<void> {
  pruneRevokedMaps();
  const now = Date.now();

  if (params.keyId) {
    setBoundedEntry(REVOKED_KEY_IDS, params.keyId, now);
    for (const [hash, entry] of MEMORY_KEY_CACHE.entries()) {
      if (entry.apiKey.id === params.keyId) {
        MEMORY_KEY_CACHE.delete(hash);
        setBoundedEntry(REVOKED_KEY_HASHES, hash, now);
        await Promise.all([
          apiKeyKv.delete(hash),
          revokedKeyKv.setJson(hash, { revokedAt: now }, { kvTtlSeconds: 3600, l1TtlMs: REVOKED_TTL_MS }),
        ]).catch(() => {});
      }
    }
  }

  if (params.keyHash) {
    setBoundedEntry(REVOKED_KEY_HASHES, params.keyHash, now);
    MEMORY_KEY_CACHE.delete(params.keyHash);
    await Promise.all([
      apiKeyKv.delete(params.keyHash),
      revokedKeyKv.setJson(
        params.keyHash,
        { revokedAt: now },
        { kvTtlSeconds: 3600, l1TtlMs: REVOKED_TTL_MS },
      ),
    ]).catch(() => {});
  }
}

export function resetStorageAuthCache(): void {
  MEMORY_KEY_CACHE.clear();
  REVOKED_KEY_HASHES.clear();
  REVOKED_KEY_IDS.clear();
  LAST_USED_AT_MAP.clear();
  inflightAuthLookups.clear();
}

function assertScopeSatisfied(
  scopes: StorageScope[] | Set<string>,
  requiredScope: StorageScope,
  options?: AuthenticateStorageOptions,
): void {
  if (hasScope(scopes, requiredScope)) {
    return;
  }
  if (
    requiredScope === "storage:admin" &&
    options?.allowMasterWriteDeleteForAdmin
  ) {
    const set = scopes instanceof Set ? scopes : new Set(scopes);
    if (set.has("storage:write") && set.has("storage:delete")) {
      return;
    }
  }
  throw new HttpError(
    "FORBIDDEN",
    `API key lacks required permission scope '${requiredScope}'`,
    403,
  );
}

function assertKeyActiveAndUnexpired(keyRecord: ApiKey, keyHash: string): void {
  if (
    keyRecord.revokedAt ||
    REVOKED_KEY_IDS.has(keyRecord.id) ||
    REVOKED_KEY_HASHES.has(keyHash)
  ) {
    throw new HttpError("UNAUTHENTICATED", "This API key has been revoked", 401);
  }
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt).getTime() <= Date.now()) {
    throw new HttpError("UNAUTHENTICATED", "API key has expired.", 401);
  }
}

function assertNamespaceAllowed(
  keyRecord: ApiKey,
  project: Project | null | undefined,
  requestedNamespace?: string,
): void {
  if (!keyRecord.projectId || !requestedNamespace) return;
  if (
    !project ||
    (project.name !== requestedNamespace && project.id !== requestedNamespace)
  ) {
    throw new HttpError(
      "FORBIDDEN",
      `API key is restricted to namespace '${project?.name ?? keyRecord.projectId}'`,
      403,
    );
  }
}

function maybeUpdateLastUsedAt(
  db: Awaited<ReturnType<typeof getStorageDb>>,
  keyId: string,
): void {
  const now = Date.now();
  const lastUpdated = LAST_USED_AT_MAP.get(keyId) ?? 0;
  if (now - lastUpdated < LAST_USED_THROTTLE_MS) {
    return;
  }
  setBoundedEntry(LAST_USED_AT_MAP, keyId, now);
  db.update(apiKeys)
    .set({ lastUsedAt: new Date(now).toISOString() })
    .where(eq(apiKeys.id, keyId))
    .catch(() => {});
}

async function loadAuthoritativeApiKey(
  rawKey: string,
  keyHash: string,
): Promise<CachedApiKeyEntry | null> {
  const service = getStorageService();

  // 1a. Try Better Auth API key (skip in offline test runner)
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    try {
      const auth = await getAuth();
      const result = await auth.api.verifyApiKey({ body: { key: rawKey } });
      if (result.valid && result.key) {
        const baKey = result.key as {
          id: string;
          name?: string | null;
          start?: string | null;
          referenceId?: string;
          userId?: string;
          expiresAt?: Date | string | null;
          permissions?: Record<string, string[]> | null;
        };
        const userId = (baKey.referenceId || baKey.userId) as string;
        if (userId) {
          const rawStoragePerms = baKey.permissions?.storage ?? [];
          const mappedScopes = rawStoragePerms.map((s) =>
            s.startsWith("storage:") ? s : `storage:${s}`,
          );
          const validated = validateStorageScopes(mappedScopes);
          if (!validated.valid) {
            throw new HttpError(
              "FORBIDDEN",
              "API key has invalid or empty storage permissions",
              403,
            );
          }

          const tenantId = `t_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
          let tenant = await service.getTenant(tenantId);
          if (!tenant) {
            tenant = await service.createTenant({
              id: tenantId,
              name: "Default Workspace",
              plan: "free",
            });
          }

          const syntheticKey: ApiKey = {
            id: baKey.id,
            tenantId: tenant.id,
            projectId: null,
            name: baKey.name || "API Key",
            keyHash,
            prefix: baKey.start || rawKey.slice(0, 12),
            scopes: validated.scopes.join(","),
            expiresAt: baKey.expiresAt ? new Date(baKey.expiresAt).toISOString() : null,
            revokedAt: null,
            lastUsedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          };

          assertKeyActiveAndUnexpired(syntheticKey, keyHash);

          return {
            version: "v1",
            tenant,
            apiKey: syntheticKey,
            project: null,
            scopes: validated.scopes,
            cachedAt: Date.now(),
          };
        }
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Non-blocking: fall back to storage_api_keys check
    }
  }

  // 1b. Check storage_api_keys table
  const db = await getStorageDb();
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash));

  if (!keyRecord) {
    return null;
  }

  assertKeyActiveAndUnexpired(keyRecord, keyHash);

  const parsedScopes = Array.from(parseScopes(keyRecord.scopes)) as StorageScope[];
  if (parsedScopes.length === 0) {
    throw new HttpError("FORBIDDEN", "API key has no valid scopes assigned", 403);
  }

  const tenant = await service.getTenant(keyRecord.tenantId);
  if (!tenant) {
    throw new HttpError("UNAUTHENTICATED", "Invalid or expired API key.", 401);
  }

  let project: Project | null = null;
  if (keyRecord.projectId) {
    project = await service.getNamespace(keyRecord.tenantId, keyRecord.projectId);
  }

  maybeUpdateLastUsedAt(db, keyRecord.id);

  return {
    version: "v1",
    tenant,
    apiKey: keyRecord,
    project,
    scopes: parsedScopes,
    cachedAt: Date.now(),
  };
}

/**
 * Authenticates an incoming request using either an API key (Bearer / x-api-key)
 * or an active user session.
 *
 * Enforces permission scopes, key expiration, revocation cache invalidation,
 * and optional project/namespace binding.
 */
export async function authenticateStorageRequest(
  request: Request | NextRequest,
  requiredScope: StorageScope = "storage:read",
  options?: AuthenticateStorageOptions,
): Promise<StorageAuthContext> {
  const service = getStorageService();
  const rawKey = extractApiKey(request);

  // 1. Programmatic access with API key
  if (rawKey) {
    const keyHash = await hashApiKey(rawKey);
    pruneRevokedMaps();

    if (REVOKED_KEY_HASHES.has(keyHash)) {
      throw new HttpError("UNAUTHENTICATED", "This API key has been revoked", 401);
    }

    const requireFresh =
      options?.forceFreshValidation === true || requiredScope === "storage:admin";

    let cachedEntry: CachedApiKeyEntry | null = null;
    if (!requireFresh) {
      const mem = MEMORY_KEY_CACHE.get(keyHash);
      if (mem && Date.now() - mem.cachedAt <= CACHE_TTL_MS) {
        cachedEntry = mem;
      } else {
        if (mem) MEMORY_KEY_CACHE.delete(keyHash);
        const kvHit = await apiKeyKv.getJson<CachedApiKeyEntry>(keyHash, {
          l1TtlMs: CACHE_TTL_MS,
        });
        if (kvHit && kvHit.version === "v1" && kvHit.tenant && kvHit.apiKey) {
          // Verify key wasn't revoked in KV before accepting KV hit
          const kvRevoked = await revokedKeyKv.getJson<{ revokedAt: number }>(keyHash, {
            l1TtlMs: 0,
          });
          if (kvRevoked) {
            setBoundedEntry(REVOKED_KEY_HASHES, keyHash, kvRevoked.revokedAt);
            throw new HttpError("UNAUTHENTICATED", "This API key has been revoked", 401);
          }
          cachedEntry = kvHit;
          setBoundedEntry(MEMORY_KEY_CACHE, keyHash, kvHit);
        }
      }
    }

    if (cachedEntry) {
      assertKeyActiveAndUnexpired(cachedEntry.apiKey, keyHash);
      assertScopeSatisfied(cachedEntry.scopes, requiredScope, options);
      assertNamespaceAllowed(cachedEntry.apiKey, cachedEntry.project, options?.namespace);

      return {
        tenant: cachedEntry.tenant,
        apiKey: cachedEntry.apiKey,
        project: cachedEntry.project,
        scopes: cachedEntry.scopes,
      };
    }

    // Stampede-coalesced authoritative lookup
    let lookupPromise = inflightAuthLookups.get(keyHash);
    if (!lookupPromise) {
      lookupPromise = loadAuthoritativeApiKey(rawKey, keyHash).finally(() => {
        inflightAuthLookups.delete(keyHash);
      });
      inflightAuthLookups.set(keyHash, lookupPromise);
    }

    const entry = await lookupPromise;
    if (!entry) {
      throw new HttpError("UNAUTHENTICATED", "Invalid or expired API key.", 401);
    }

    assertKeyActiveAndUnexpired(entry.apiKey, keyHash);
    assertScopeSatisfied(entry.scopes, requiredScope, options);
    assertNamespaceAllowed(entry.apiKey, entry.project, options?.namespace);

    setBoundedEntry(MEMORY_KEY_CACHE, keyHash, entry);
    await apiKeyKv.setJson(keyHash, entry, {
      kvTtlSeconds: KV_CACHE_TTL_SECONDS,
      l1TtlMs: CACHE_TTL_MS,
    });

    return {
      tenant: entry.tenant,
      apiKey: entry.apiKey,
      project: entry.project,
      scopes: entry.scopes,
    };
  }

  // 2. Dashboard / User session access
  const session = await getSession(request.headers);
  if (session?.user) {
    const userId = session.user.id;
    const tenantId = `t_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    let tenant = await service.getTenant(tenantId);

    if (!tenant) {
      tenant = await service.createTenant({
        id: tenantId,
        name: session.user.name || session.user.email || "Default Workspace",
        plan: "free",
      });
    }

    return {
      tenant,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
      scopes: ["storage:read", "storage:write", "storage:delete", "storage:admin"],
    };
  }

  throw new HttpError(
    "UNAUTHENTICATED",
    "Authentication required. Provide an API key via 'Authorization: Bearer <key>' or 'x-api-key: <key>', or login.",
    401,
  );
}
