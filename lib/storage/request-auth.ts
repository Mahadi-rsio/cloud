import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";
import { getRedis } from "@/lib/redis";
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
}

interface CachedApiKeyEntry {
  tenant: Tenant;
  apiKey: ApiKey;
  project?: Project | null;
  scopes: StorageScope[];
  cachedAt: number;
}

const MEMORY_KEY_CACHE = new Map<string, CachedApiKeyEntry>();
const REVOKED_KEY_HASHES = new Map<string, number>();
const REVOKED_KEY_IDS = new Map<string, number>();
const CACHE_TTL_MS = 60_000;
const REVOKED_TTL_MS = 3_600_000;

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
 * Immediately invalidates both in-memory cache and Redis cache entries.
 */
export async function invalidateApiKeyCache(params: {
  keyId?: string;
  keyHash?: string;
}): Promise<void> {
  pruneRevokedMaps();
  const now = Date.now();

  if (params.keyId) {
    REVOKED_KEY_IDS.set(params.keyId, now);
    for (const [hash, entry] of MEMORY_KEY_CACHE.entries()) {
      if (entry.apiKey.id === params.keyId) {
        MEMORY_KEY_CACHE.delete(hash);
        REVOKED_KEY_HASHES.set(hash, now);
      }
    }
  }

  if (params.keyHash) {
    REVOKED_KEY_HASHES.set(params.keyHash, now);
    MEMORY_KEY_CACHE.delete(params.keyHash);
    try {
      const redis = await getRedis();
      await redis.del(`storage:apikey:${params.keyHash}`);
    } catch {
      // Fail-safe: in-memory revocation tombstone still blocks the key
    }
  }
}

export function resetStorageAuthCache(): void {
  MEMORY_KEY_CACHE.clear();
  REVOKED_KEY_HASHES.clear();
  REVOKED_KEY_IDS.clear();
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
    const cacheKey = `storage:apikey:${keyHash}`;
    pruneRevokedMaps();

    if (REVOKED_KEY_HASHES.has(keyHash)) {
      throw new HttpError("UNAUTHENTICATED", "This API key has been revoked", 401);
    }

    // Check fast in-memory or Redis cache
    let cachedEntry: CachedApiKeyEntry | null = MEMORY_KEY_CACHE.get(keyHash) ?? null;
    if (cachedEntry && Date.now() - cachedEntry.cachedAt > CACHE_TTL_MS) {
      MEMORY_KEY_CACHE.delete(keyHash);
      cachedEntry = null;
    }

    if (!cachedEntry) {
      try {
        const redis = await getRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
          if (parsed && parsed.tenant && parsed.apiKey && Array.isArray(parsed.scopes)) {
            cachedEntry = parsed as CachedApiKeyEntry;
          }
        }
      } catch {
        // Non-blocking: continue to authoritative verification
      }
    }

    if (cachedEntry) {
      // Check live DB record if available to prevent race between revocation and cache hit
      try {
        const db = await getStorageDb();
        const [liveKey] = await db
          .select()
          .from(apiKeys)
          .where(eq(apiKeys.id, cachedEntry.apiKey.id));
        if (liveKey) {
          cachedEntry.apiKey = liveKey;
          cachedEntry.scopes = Array.from(parseScopes(liveKey.scopes)) as StorageScope[];
        }
      } catch {
        // Ignore transient DB lookup failure on cached hit
      }

      assertKeyActiveAndUnexpired(cachedEntry.apiKey, keyHash);
      assertScopeSatisfied(cachedEntry.scopes, requiredScope, options);
      assertNamespaceAllowed(cachedEntry.apiKey, cachedEntry.project, options?.namespace);

      const freshTenant = await service.getTenant(cachedEntry.tenant.id);
      if (!freshTenant) {
        throw new HttpError("UNAUTHENTICATED", "Tenant not found for API key.", 401);
      }

      return {
        tenant: freshTenant,
        apiKey: cachedEntry.apiKey,
        project: cachedEntry.project,
        scopes: cachedEntry.scopes,
      };
    }

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

            assertScopeSatisfied(validated.scopes, requiredScope, options);

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
              tenant,
              apiKey: syntheticKey,
              scopes: validated.scopes,
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
      throw new HttpError("UNAUTHENTICATED", "Invalid or expired API key.", 401);
    }

    assertKeyActiveAndUnexpired(keyRecord, keyHash);

    const parsedScopes = Array.from(parseScopes(keyRecord.scopes)) as StorageScope[];
    if (parsedScopes.length === 0) {
      throw new HttpError("FORBIDDEN", "API key has no valid scopes assigned", 403);
    }

    assertScopeSatisfied(parsedScopes, requiredScope, options);

    const tenant = await service.getTenant(keyRecord.tenantId);
    if (!tenant) {
      throw new HttpError("UNAUTHENTICATED", "Invalid or expired API key.", 401);
    }

    let project: Project | null = null;
    if (keyRecord.projectId) {
      project = await service.getNamespace(keyRecord.tenantId, keyRecord.projectId);
    }

    assertNamespaceAllowed(keyRecord, project, options?.namespace);

    // Update lastUsedAt asynchronously
    db.update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, keyRecord.id))
      .catch(() => {});

    const entryToCache: CachedApiKeyEntry = {
      tenant,
      apiKey: keyRecord,
      project,
      scopes: parsedScopes,
      cachedAt: Date.now(),
    };
    MEMORY_KEY_CACHE.set(keyHash, entryToCache);

    try {
      const redis = await getRedis();
      await redis.set(cacheKey, JSON.stringify(entryToCache), { ex: 60 });
    } catch {
      // Non-blocking
    }

    return {
      tenant,
      apiKey: keyRecord,
      project,
      scopes: parsedScopes,
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
