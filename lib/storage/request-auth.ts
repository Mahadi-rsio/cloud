import type { NextRequest } from "next/server";
import { eq, and, isNull } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";
import { getRedis } from "@/lib/redis";
import { extractApiKey, hashApiKey, type StorageScope } from "./auth";
import { getStorageDb } from "./db";
import { getStorageService } from "./service";
import { apiKeys, type Project, type Tenant } from "./schema";

export interface StorageAuthContext {
  tenant: Tenant;
  user?: { id: string; email?: string; name?: string };
  project?: Project | null;
}

/**
 * Authenticates an incoming request using either an API key (Bearer / x-api-key)
 * or an active user session.
 *
 * API key authentication is handled by Better Auth's @better-auth/api-key plugin
 * via `auth.api.verifyApiKey()`. The key is associated with a user (referenceId),
 * and a storage tenant is derived from that user ID.
 *
 * Auth hot path: verified API keys are cached in Redis / in-memory cache for
 * 60 seconds to avoid hitting the database on every storage request.
 */
export async function authenticateStorageRequest(
  request: Request | NextRequest,
  requiredScope: StorageScope = "storage:read",
): Promise<StorageAuthContext> {
  const service = getStorageService();
  const rawKey = extractApiKey(request);

  // 1. Programmatic access with Better Auth API key
  if (rawKey) {
    const keyHash = await hashApiKey(rawKey);
    const cacheKey = `storage:apikey:${keyHash}`;

    // Check fast cache
    try {
      const redis = await getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) {
        const tenant = JSON.parse(cached) as Tenant;
        return { tenant };
      }
    } catch {
      // Non-blocking: continue to authoritative verification
    }

    let tenant: Tenant | null = null;

    // 1a. Try Better Auth API key
    try {
      const auth = await getAuth();
      const result = await auth.api.verifyApiKey({ body: { key: rawKey } });
      if (result.valid && result.key) {
        const userId = result.key.referenceId as string;
        const tenantId = `t_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
        tenant = await service.getTenant(tenantId);
        if (!tenant) {
          tenant = await service.createTenant({
            id: tenantId,
            name: "Default Workspace",
            plan: "free",
          });
        }
      }
    } catch {
      // Non-blocking: fall back to storage_api_keys check
    }

    // 1b. Check storage_api_keys table
    if (!tenant) {
      try {
        const db = await getStorageDb();
        const [keyRecord] = await db
          .select()
          .from(apiKeys)
          .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)));

        if (keyRecord) {
          if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
            throw new HttpError("UNAUTHENTICATED", "API key has expired.", 401);
          }
          tenant = await service.getTenant(keyRecord.tenantId);

          // Update lastUsedAt asynchronously
          db.update(apiKeys)
            .set({ lastUsedAt: new Date().toISOString() })
            .where(eq(apiKeys.id, keyRecord.id))
            .catch(() => {});
        }
      } catch (err) {
        if (err instanceof HttpError) throw err;
      }
    }

    if (!tenant) {
      throw new HttpError("UNAUTHENTICATED", "Invalid or expired API key.", 401);
    }

    // Cache verified tenant for 60 seconds
    try {
      const redis = await getRedis();
      await redis.set(cacheKey, JSON.stringify(tenant), { ex: 60 });
    } catch {
      // Non-blocking
    }

    return { tenant };
  }

  // 2. Dashboard / User session access
  const session = await getSession();
  if (session?.user) {
    const userId = session.user.id;
    // Derive a consistent tenant ID from the user ID
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
    };
  }

  throw new HttpError(
    "UNAUTHENTICATED",
    "Authentication required. Provide an API key via 'Authorization: Bearer <key>' or 'x-api-key: <key>', or login.",
    401,
  );
}
