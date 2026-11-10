import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";
import { extractApiKey, type StorageScope } from "./auth";
import { getStorageService } from "./service";
import type { ApiKey, Project, Tenant } from "./schema";

export interface StorageAuthContext {
  tenant: Tenant;
  apiKey?: ApiKey;
  user?: { id: string; email?: string; name?: string };
  project?: Project | null;
}

/**
 * Authenticates an incoming request using either an API key (Bearer / x-api-key)
 * or an active user session.
 */
export async function authenticateStorageRequest(
  request: Request | NextRequest,
  requiredScope: StorageScope = "storage:read",
): Promise<StorageAuthContext> {
  const service = getStorageService();
  const rawKey = extractApiKey(request);

  // 1. Programmatic access with API key
  if (rawKey) {
    const auth = await service.authenticateApiKey(rawKey, requiredScope);
    return {
      tenant: auth.tenant,
      apiKey: auth.apiKey,
      project: auth.project,
    };
  }

  // 2. Dashboard / User session access
  const session = await getSession();
  if (session?.user) {
    const userId = session.user.id;
    // Derive a consistent tenant ID from the user ID
    const tenantId = `t_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    let tenant = await service.getTenant(tenantId);

    if (!tenant) {
      tenant = await service.createTenant({
        name: session.user.name || session.user.email || "Default Workspace",
        plan: "free",
      });
    }

    return {
      tenant,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    };
  }

  throw new HttpError(
    "UNAUTHENTICATED",
    "Authentication required. Provide an API key via 'Authorization: Bearer <sk_live_...>' or login.",
    401,
  );
}
