import type { RateLimitInfo } from "./types.js";

export function parseRateLimitHeaders(headers: Headers): RateLimitInfo | undefined {
  const limitRaw = headers.get("x-ratelimit-limit");
  const remainingRaw = headers.get("x-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset");
  const retryAfterRaw = headers.get("retry-after");

  if (!limitRaw && !remainingRaw && !resetRaw && !retryAfterRaw) {
    return undefined;
  }

  const parseNum = (val: string | null): number | undefined => {
    if (!val) return undefined;
    const n = Number(val);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    limit: parseNum(limitRaw),
    remaining: parseNum(remainingRaw),
    resetAt: parseNum(resetRaw),
    retryAfterSeconds: parseNum(retryAfterRaw),
  };
}

export class StorageApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly rateLimit?: RateLimitInfo;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    rateLimit?: RateLimitInfo;
  }) {
    super(options.message);
    this.name = "StorageApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.rateLimit = options.rateLimit;
  }
}
