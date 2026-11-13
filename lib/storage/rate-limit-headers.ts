/**
 * Server-side rate limiting and rate-limit response header helpers for the Storage API.
 *
 * Uses Redis fixed-window counters (with mandatory TTL expiration) per tenant
 * (or per key / IP fallback) and operation class.
 */

import { HttpError } from "@/lib/http";
import { getRedis } from "@/lib/redis";

export type StorageRateLimitOperation =
  | "read"
  | "write"
  | "delete"
  | "list"
  | "presign"
  | "api_key"
  | "namespace"
  | "tenant";

export interface StorageRateLimitConfig {
  limit: number;
  windowSeconds: number;
}

const DEFAULT_OPERATION_LIMITS: Record<StorageRateLimitOperation, StorageRateLimitConfig> = {
  read: { limit: 1000, windowSeconds: 60 },
  list: { limit: 600, windowSeconds: 60 },
  write: { limit: 300, windowSeconds: 60 },
  delete: { limit: 300, windowSeconds: 60 },
  presign: { limit: 120, windowSeconds: 60 },
  api_key: { limit: 60, windowSeconds: 60 },
  namespace: { limit: 60, windowSeconds: 60 },
  tenant: { limit: 30, windowSeconds: 60 },
};

// In-memory rate limit counter fallback for test isolation and Redis failover
const memoryWindows = new Map<string, { count: number; resetAtMs: number }>();

let customRateLimitOverrides: Partial<Record<StorageRateLimitOperation, StorageRateLimitConfig>> = {};

export function setStorageRateLimitOverrides(
  overrides: Partial<Record<StorageRateLimitOperation, StorageRateLimitConfig>>,
): void {
  customRateLimitOverrides = { ...overrides };
}

export function resetStorageRateLimits(): void {
  memoryWindows.clear();
  customRateLimitOverrides = {};
}

/**
 * Utility to add standard rate-limit response headers to any Headers object.
 */
export function addRateLimitHeaders(
  headers: Headers,
  limit: number,
  remaining: number,
  resetAt: Date,
): void {
  headers.set("X-RateLimit-Limit", String(limit));
  headers.set("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  headers.set("X-RateLimit-Reset", String(Math.floor(resetAt.getTime() / 1000)));
}

/**
 * Returns a Date representing the end of the current clock hour (UTC).
 */
export function endOfCurrentHour(): Date {
  const now = new Date();
  now.setUTCMinutes(59, 59, 999);
  return now;
}

/**
 * Enforce per-tenant / per-subject rate limit for a Storage API operation and
 * populate `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` on `headers`.
 * Throws `429 RATE_LIMITED` (with `Retry-After` info) when the limit is exceeded.
 */
export async function checkStorageRateLimit(
  subjectId: string,
  operation: StorageRateLimitOperation,
  headers?: Headers,
): Promise<{
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}> {
  const cfg = customRateLimitOverrides[operation] ?? DEFAULT_OPERATION_LIMITS[operation];
  const windowMs = cfg.windowSeconds * 1000;
  const now = Date.now();
  const bucketId = Math.floor(now / windowMs);
  const resetAtMs = (bucketId + 1) * windowMs;
  const resetAt = new Date(resetAtMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  const key = `storage:rl:${subjectId}:${operation}:${bucketId}`;

  let count = 0;
  let usedRedis = false;

  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    try {
      const redis = await getRedis();
      count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, cfg.windowSeconds);
      }
      usedRedis = true;
    } catch {
      // Fail safe to in-memory counter if Redis is unavailable
    }
  }

  if (!usedRedis) {
    // Prune expired windows occasionally
    if (memoryWindows.size > 2000) {
      for (const [k, v] of memoryWindows) {
        if (v.resetAtMs <= now) memoryWindows.delete(k);
      }
    }
    const existing = memoryWindows.get(key);
    if (!existing || existing.resetAtMs <= now) {
      count = 1;
      memoryWindows.set(key, { count: 1, resetAtMs });
    } else {
      existing.count += 1;
      count = existing.count;
    }
  }

  const remaining = Math.max(0, cfg.limit - count);
  if (headers) {
    addRateLimitHeaders(headers, cfg.limit, remaining, resetAt);
  }

  if (count > cfg.limit) {
    if (headers) {
      headers.set("Retry-After", String(retryAfterSeconds));
    }
    throw new HttpError(
      "RATE_LIMITED",
      `Rate limit exceeded for storage ${operation} operations. Retry after ${retryAfterSeconds}s.`,
      429,
    );
  }

  return {
    limit: cfg.limit,
    remaining,
    resetAt,
    retryAfterSeconds,
  };
}
