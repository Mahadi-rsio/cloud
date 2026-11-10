import type { NextRequest } from "next/server";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { createTenantSchema } from "@/lib/storage/validators";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const service = getStorageService();
    const usage = await service.getTenantUsage(auth.tenant.id);

    return jsonOk({
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
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createTenantSchema.parse(await readJson(request));
    const service = getStorageService();
    const tenant = await service.createTenant(body);

    return jsonOk(
      {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          plan: tenant.plan,
          trialEndsAt: tenant.trialEndsAt,
          createdAt: tenant.createdAt,
        },
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
