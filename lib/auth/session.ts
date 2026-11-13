import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

async function resolveSession(
  resolvedHeaders: Headers,
  disableCookieCache = false,
) {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    const testUserId = resolvedHeaders.get("x-test-user-id");
    if (testUserId) {
      return {
        user: {
          id: testUserId,
          email: resolvedHeaders.get("x-test-user-email") || `${testUserId}@example.com`,
          name: resolvedHeaders.get("x-test-user-name") || `User ${testUserId}`,
        },
      };
    }
    return null;
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: resolvedHeaders,
    ...(disableCookieCache ? { query: { disableCookieCache: true } } : {}),
  });
  return session;
}

/**
 * Deduplicates repeated `getSession()` calls within the same React Server
 * Component request (e.g. `layout.tsx` + `page.tsx`).
 */
const getCachedRscSession = cache(async () => {
  const resolvedHeaders = await headers();
  return resolveSession(resolvedHeaders, false);
});

export async function getSession(requestHeaders?: Headers) {
  try {
    if (!requestHeaders) {
      return await getCachedRscSession();
    }
    return await resolveSession(requestHeaders, false);
  } catch {
    return null;
  }
}

/**
 * Forces an authoritative database session lookup, bypassing cookie cache.
 * Use for sensitive operations (password changes, API key creation/revocation,
 * tenant/account deletion).
 */
export async function getFreshSession(requestHeaders?: Headers) {
  try {
    const resolvedHeaders = requestHeaders ?? (await headers());
    return await resolveSession(resolvedHeaders, true);
  } catch {
    return null;
  }
}
