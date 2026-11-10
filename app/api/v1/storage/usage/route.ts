import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const service = getStorageService();
    const usage = await service.getTenantUsage(auth.tenant.id);

    return jsonOk({
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
    });
  } catch (error) {
    return errorResponse(error);
  }
}
