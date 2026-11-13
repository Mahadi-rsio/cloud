import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { getSession } from "@/lib/auth/session";
import { extractApiKey } from "@/lib/storage/auth";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { createTenantSchema } from "@/lib/storage/validators";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

function isAuthorizedInternalRequest(request: Request): boolean {
  const internalToken = process.env.INTERNAL_API_TOKEN?.trim();
  const received = request.headers.get("x-internal-token")?.trim();
  if (internalToken && received && received === internalToken) {
    return true;
  }
  if (
    (process.env.VITEST || process.env.NODE_ENV === "test") &&
    request.headers.get("x-test-internal-admin") === "1"
  ) {
    return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const rlHeaders = new Headers();
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    await checkStorageRateLimit(auth.tenant.id, "tenant", rlHeaders);
    const service = getStorageService();
    const usage = await service.getTenantUsage(auth.tenant.id);

    return jsonOk(
      {
        tenant: {
          id: auth.tenant.id,
          name: auth.tenant.name,
          status: auth.tenant.status,
          plan: auth.tenant.plan,
          storageLimitBytes: auth.tenant.storageLimitBytes,
          monthlyReadLimitOps: auth.tenant.monthlyReadLimitOps,
          monthlyWriteLimitOps: auth.tenant.monthlyWriteLimitOps,
          bandwidthLimitBytes: auth.tenant.bandwidthLimitBytes,
          egressRateLimitMbps: auth.tenant.egressRateLimitMbps,
          trialEndsAt: auth.tenant.trialEndsAt,
          createdAt: auth.tenant.createdAt,
        },
        usage,
      },
      200,
      rlHeaders,
    );
  } catch (error) {
    return errorResponse(error, rlHeaders);
  }
}

export async function POST(request: NextRequest) {
  const rlHeaders = new Headers();
  try {
    const rawBody = await readJson(request);
    const body = createTenantSchema.parse(rawBody);
    const service = getStorageService();

    // 1. Authorized internal service-to-service or test-admin provisioning
    if (isAuthorizedInternalRequest(request)) {
      const tenant = await service.createTenant({
        ...body,
        allowCustomQuotas: true,
      });
      return jsonOk(
        {
          tenant: {
            id: tenant.id,
            name: tenant.name,
            status: tenant.status,
            plan: tenant.plan,
            storageLimitBytes: tenant.storageLimitBytes,
            trialEndsAt: tenant.trialEndsAt,
            createdAt: tenant.createdAt,
          },
        },
        201,
        rlHeaders,
      );
    }

    // 2. If API key is presented, require `storage:admin` and block cross-tenant or quota-override attempts
    const rawKey = extractApiKey(request);
    if (rawKey) {
      const auth = await authenticateStorageRequest(request, "storage:admin");
      await checkStorageRateLimit(auth.tenant.id, "tenant", rlHeaders);

      if (body.id && body.id !== auth.tenant.id) {
        throw new HttpError(
          "FORBIDDEN",
          "Cannot provision a tenant for a different tenant ID",
          403,
        );
      }
      if (
        (body.plan && body.plan !== "free" && body.plan !== auth.tenant.plan) ||
        body.storageLimitBytes !== undefined ||
        body.bandwidthLimitBytes !== undefined ||
        body.egressRateLimitMbps !== undefined
      ) {
        throw new HttpError(
          "FORBIDDEN",
          "Client-supplied plan or quota overrides are not permitted",
          403,
        );
      }
      return jsonOk(
        {
          tenant: {
            id: auth.tenant.id,
            name: auth.tenant.name,
            status: auth.tenant.status,
            plan: auth.tenant.plan,
            storageLimitBytes: auth.tenant.storageLimitBytes,
            trialEndsAt: auth.tenant.trialEndsAt,
            createdAt: auth.tenant.createdAt,
          },
        },
        200,
        rlHeaders,
      );
    }

    // 3. Otherwise require an active authenticated user session
    const session = await getSession(request.headers);
    if (!session?.user) {
      throw new HttpError(
        "UNAUTHENTICATED",
        "Authentication required to provision a storage tenant.",
        401,
      );
    }

    const userId = session.user.id;
    const expectedTenantId = `t_${userId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    await checkStorageRateLimit(expectedTenantId, "tenant", rlHeaders);

    if (body.id && body.id !== expectedTenantId) {
      throw new HttpError(
        "FORBIDDEN",
        "Cannot provision a tenant for another user ID.",
        403,
      );
    }

    if (
      (body.plan && body.plan !== "free") ||
      body.storageLimitBytes !== undefined ||
      body.bandwidthLimitBytes !== undefined ||
      body.egressRateLimitMbps !== undefined
    ) {
      throw new HttpError(
        "FORBIDDEN",
        "Client-supplied plan or quota overrides are not permitted during self-provisioning.",
        403,
      );
    }

    const existing = await service.getTenant(expectedTenantId);
    if (existing) {
      return jsonOk(
        {
          tenant: {
            id: existing.id,
            name: existing.name,
            status: existing.status,
            plan: existing.plan,
            storageLimitBytes: existing.storageLimitBytes,
            trialEndsAt: existing.trialEndsAt,
            createdAt: existing.createdAt,
          },
        },
        200,
        rlHeaders,
      );
    }

    const tenant = await service.createTenant({
      id: expectedTenantId,
      name: body.name || session.user.name || session.user.email || "Default Workspace",
      plan: "free",
    });

    return jsonOk(
      {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          plan: tenant.plan,
          storageLimitBytes: tenant.storageLimitBytes,
          trialEndsAt: tenant.trialEndsAt,
          createdAt: tenant.createdAt,
        },
      },
      201,
      rlHeaders,
    );
  } catch (error) {
    return errorResponse(error, rlHeaders);
  }
}
