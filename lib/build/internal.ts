import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify the shared secret used by the builder machine when it calls back into
 * the control plane. These routes are never exposed to end users.
 */
export async function requireInternalToken(request: Request): Promise<void> {
  const env = await getEnv();
  if (!env.INTERNAL_API_TOKEN) {
    throw new HttpError(
      "PROVIDER_ERROR",
      "INTERNAL_API_TOKEN is not configured.",
      500,
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !constantTimeEqual(match[1], env.INTERNAL_API_TOKEN)) {
    throw new HttpError("UNAUTHENTICATED", "Invalid internal token.", 401);
  }
}