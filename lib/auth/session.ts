import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

export async function getSession(requestHeaders?: Headers) {
  try {
    const resolvedHeaders = requestHeaders ?? (await headers());
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
    });
    return session;
  } catch {
    return null;
  }
}
