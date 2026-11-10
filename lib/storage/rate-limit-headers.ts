/**
 * Utility to add standard rate-limit response headers to any Headers object.
 *
 * Since per-tenant rate-limit counters are not yet tracked, callers should pass
 * reasonable static values. These headers allow clients to anticipate throttling
 * before it occurs.
 */
export function addRateLimitHeaders(
  headers: Headers,
  limit: number,
  remaining: number,
  resetAt: Date,
): void {
  headers.set("X-RateLimit-Limit", String(limit));
  headers.set("X-RateLimit-Remaining", String(remaining));
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
