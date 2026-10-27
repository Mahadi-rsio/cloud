import { HttpError } from "@/lib/http";
import { getRedis } from "@/lib/redis";

export interface RateLimitRule {
  limit?: number;
  windowSeconds?: number;
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function assertRateLimit(
  key: string,
  rule: RateLimitRule = {},
) {
  const limit = rule.limit ?? 100;
  const windowSeconds = rule.windowSeconds ?? 60;
  const redis = await getRedis();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  if (count > limit) {
    console.warn(
      `[rate-limit] blocked ${key}: count=${count} limit=${limit} window=${windowSeconds}s`,
    );
    throw new HttpError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      429,
      { retryAfter: windowSeconds },
    );
  }
  console.log(`[rate-limit] ${key}: ${count}/${limit} (window ${windowSeconds}s)`);
}