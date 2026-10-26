import { HttpError } from "@/lib/http";
import { getKvBinding } from "@/lib/auth/storage/kv";

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
  const kv = await getKvBinding();
  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= limit) {
    throw new HttpError(
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      429,
      { retryAfter: windowSeconds },
    );
  }

  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
}