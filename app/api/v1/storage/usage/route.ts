import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

export async function GET(request: NextRequest) {
  const headers = new Headers();
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    await checkStorageRateLimit(auth.tenant.id, "read", headers);

    const service = getStorageService();
    const usage = await service.getTenantUsage(auth.tenant.id);

    return jsonOk(
      {
        tenantId: auth.tenant.id,
        plan: auth.tenant.plan,
        limits: {
          storageLimitBytes: auth.tenant.storageLimitBytes,
          monthlyReadLimitOps: auth.tenant.monthlyReadLimitOps,
          monthlyWriteLimitOps: auth.tenant.monthlyWriteLimitOps,
          bandwidthLimitBytes: auth.tenant.bandwidthLimitBytes,
          egressRateLimitMbps: auth.tenant.egressRateLimitMbps,
        },
        usage,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
