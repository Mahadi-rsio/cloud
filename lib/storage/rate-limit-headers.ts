/**
 * Server-side rate limiting and rate-limit response header helpers for the Storage API.
 *
 * Uses Cloudflare Workers Rate Limiting bindings in production (approximate,
 * per-POP, 60s window) and bounded in-memory fixed-window counters in local dev
 * and Vitest. Strict quota enforcement is handled by TenantMeterDO.
 */

import { HttpError } from "@/lib/http";
import type { RateLimitBindingLike, RateLimitPlan } from "@/lib/rate-limit";

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

const PRO_OPERATION_LIMITS: Record<StorageRateLimitOperation, StorageRateLimitConfig> = {
  read: { limit: 5000, windowSeconds: 60 },
  list: { limit: 5000, windowSeconds: 60 },
  write: { limit: 1500, windowSeconds: 60 },
  delete: { limit: 1500, windowSeconds: 60 },
  presign: { limit: 1500, windowSeconds: 60 },
  api_key: { limit: 60, windowSeconds: 60 },
  namespace: { limit: 60, windowSeconds: 60 },
  tenant: { limit: 60, windowSeconds: 60 },
};

const memoryWindows = new Map<string, { count: number; resetAtMs: number }>();
const warnedMissing = new Set<string>();
const MAX_MEMORY_WINDOWS = 5000;

let customRateLimitOverrides: Partial<Record<StorageRateLimitOperation, StorageRateLimitConfig>> = {};

export function setStorageRateLimitOverrides(
  overrides: Partial<Record<StorageRateLimitOperation, StorageRateLimitConfig>>,
): void {
  customRateLimitOverrides = { ...overrides };
}

export function resetStorageRateLimits(): void {
  memoryWindows.clear();
  warnedMissing.clear();
  customRateLimitOverrides = {};
}

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

export function endOfCurrentHour(): Date {
  const now = new Date();
  now.setUTCMinutes(59, 59, 999);
  return now;
}

function resolveStorageBindingName(
  operation: StorageRateLimitOperation,
  plan: RateLimitPlan = "free",
): string {
  const isPaid = plan === "pro" || plan === "enterprise";
  if (operation === "read" || operation === "list") {
    return isPaid ? "RL_STORAGE_PRO_READ" : "RL_STORAGE_READ";
  }
  if (operation === "write" || operation === "delete" || operation === "presign") {
    return isPaid ? "RL_STORAGE_PRO_WRITE" : "RL_STORAGE_WRITE";
  }
  return "RL_STORAGE_ADMIN";
}

async function resolveCfStorageLimiter(
  bindingName: string,
): Promise<{ inWorkers: boolean; binding: RateLimitBindingLike | null }> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return { inWorkers: false, binding: null };
  }
  try {
    const { env } = await import("cloudflare:workers");
    const envRecord = env as unknown as Record<string, unknown>;
    const candidate = envRecord?.[bindingName] as RateLimitBindingLike | undefined;
    if (candidate && typeof candidate.limit === "function") {
      return { inWorkers: true, binding: candidate };
    }
    return { inWorkers: true, binding: null };
  } catch {
    return { inWorkers: false, binding: null };
  }
}

export async function checkStorageRateLimit(
  subjectId: string,
  operation: StorageRateLimitOperation,
  headers?: Headers,
  plan: RateLimitPlan = "free",
): Promise<{
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}> {
  const baseLimits =
    plan === "pro" || plan === "enterprise"
      ? PRO_OPERATION_LIMITS[operation]
      : DEFAULT_OPERATION_LIMITS[operation];
  const cfg = customRateLimitOverrides[operation] ?? baseLimits;
  const windowMs = cfg.windowSeconds * 1000;
  const now = Date.now();
  const bucketId = Math.floor(now / windowMs);
  const resetAtMs = (bucketId + 1) * windowMs;
  const resetAt = new Date(resetAtMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  const key = `storage:rl:${subjectId}:${operation}`;

  const hasCustomOverride = Boolean(customRateLimitOverrides[operation]);
  if (!hasCustomOverride) {
    const bindingName = resolveStorageBindingName(operation, plan);
    const { inWorkers, binding } = await resolveCfStorageLimiter(bindingName);

    if (binding) {
      try {
        const outcome = await binding.limit({ key });
        if (headers) {
          headers.set("X-RateLimit-Limit", String(cfg.limit));
          headers.set("X-RateLimit-Reset", String(Math.floor(resetAt.getTime() / 1000)));
          headers.set("X-RateLimit-Policy", `${cfg.limit};w=${cfg.windowSeconds}`);
          if (!outcome.success) {
            headers.set("X-RateLimit-Remaining", "0");
            headers.set("Retry-After", String(retryAfterSeconds));
          }
        }
        if (!outcome.success) {
          throw new HttpError(
            "RATE_LIMITED",
            `Rate limit exceeded for storage ${operation} operations. Retry after ${retryAfterSeconds}s.`,
            429,
          );
        }
        return {
          limit: cfg.limit,
          remaining: cfg.limit,
          resetAt,
          retryAfterSeconds,
        };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        // Fall through to isolate-local counter on transient binding failure
      }
    } else if (inWorkers && !warnedMissing.has(bindingName)) {
      warnedMissing.add(bindingName);
      console.warn(
        `[storage-rate-limit] Missing Cloudflare binding '${bindingName}'; falling back to isolate-local limiter.`,
      );
    }
  }

  // Isolate-local / Vitest fixed-window counter
  const memKey = `${key}:${bucketId}`;
  if (memoryWindows.size >= MAX_MEMORY_WINDOWS && !memoryWindows.has(memKey)) {
    for (const [k, v] of memoryWindows) {
      if (v.resetAtMs <= now) memoryWindows.delete(k);
    }
    if (memoryWindows.size >= MAX_MEMORY_WINDOWS) {
      const oldest = memoryWindows.keys().next().value;
      if (oldest !== undefined) memoryWindows.delete(oldest);
    }
  }

  let count: number;
  const existing = memoryWindows.get(memKey);
  if (!existing || existing.resetAtMs <= now) {
    count = 1;
    memoryWindows.set(memKey, { count: 1, resetAtMs });
  } else {
    existing.count += 1;
    count = existing.count;
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
