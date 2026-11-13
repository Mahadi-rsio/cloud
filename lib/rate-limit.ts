import { HttpError } from "@/lib/http";

export type RateLimitCategory = "api" | "studio" | "storage";
export type RateLimitPlan = "free" | "pro" | "enterprise";

export interface RateLimitRule {
  limit?: number;
  windowSeconds?: number;
  category?: RateLimitCategory;
  plan?: RateLimitPlan;
}

export interface RateLimitBindingLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

const memoryWindows = new Map<string, { count: number; resetAtMs: number }>();
const warnedMissingBindings = new Set<string>();
const MAX_MEMORY_WINDOWS = 5000;

export function resetRateLimits(): void {
  memoryWindows.clear();
  warnedMissingBindings.clear();
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function resolveBindingName(key: string, rule: RateLimitRule): string {
  const category =
    rule.category ??
    (key.startsWith("studio:") ? "studio" : "api");
  if (category === "studio") return "RL_STUDIO";
  if (rule.plan === "pro" || rule.plan === "enterprise") return "RL_API_PRO";
  return "RL_API_FREE";
}

async function getCfRateLimitBinding(
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

function checkMemoryWindow(
  key: string,
  limit: number,
  windowSeconds: number,
): { allowed: boolean; count: number; retryAfterSeconds: number } {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const bucketId = Math.floor(now / windowMs);
  const resetAtMs = (bucketId + 1) * windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  const bucketKey = `${key}:${bucketId}`;

  if (memoryWindows.size >= MAX_MEMORY_WINDOWS && !memoryWindows.has(bucketKey)) {
    for (const [k, v] of memoryWindows) {
      if (v.resetAtMs <= now) memoryWindows.delete(k);
    }
    if (memoryWindows.size >= MAX_MEMORY_WINDOWS) {
      const oldest = memoryWindows.keys().next().value;
      if (oldest !== undefined) memoryWindows.delete(oldest);
    }
  }

  const existing = memoryWindows.get(bucketKey);
  let count: number;
  if (!existing || existing.resetAtMs <= now) {
    count = 1;
    memoryWindows.set(bucketKey, { count: 1, resetAtMs });
  } else {
    existing.count += 1;
    count = existing.count;
  }

  return {
    allowed: count <= limit,
    count,
    retryAfterSeconds,
  };
}

export async function assertRateLimit(
  key: string,
  rule: RateLimitRule = {},
): Promise<void> {
  const limit = rule.limit ?? 100;
  const windowSeconds = rule.windowSeconds ?? 60;
  const bindingName = resolveBindingName(key, rule);
  const { inWorkers, binding } = await getCfRateLimitBinding(bindingName);

  if (binding) {
    try {
      const outcome = await binding.limit({ key });
      if (!outcome.success) {
        console.warn(`[rate-limit] blocked key=${key} binding=${bindingName}`);
        throw new HttpError(
          "RATE_LIMITED",
          "Too many requests. Please try again later.",
          429,
          { retryAfter: windowSeconds },
        );
      }
      return;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // Fall through to isolate-local limiter if CF rate limit RPC fails transiently
      if (!warnedMissingBindings.has(`${bindingName}:err`)) {
        warnedMissingBindings.add(`${bindingName}:err`);
        console.warn(`[rate-limit] ${bindingName} error, using isolate fallback`);
      }
    }
  } else if (inWorkers && !warnedMissingBindings.has(bindingName)) {
    warnedMissingBindings.add(bindingName);
    console.warn(
      `[rate-limit] Missing Cloudflare rate limit binding '${bindingName}'; falling back to isolate-local limiter.`,
    );
  }

  const mem = checkMemoryWindow(key, limit, windowSeconds);
  if (!mem.allowed) {
    console.warn(
      `[rate-limit] blocked ${key}: count=${mem.count} limit=${limit} window=${windowSeconds}s`,
    );
    throw new HttpError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      429,
      { retryAfter: mem.retryAfterSeconds },
    );
  }
}
