import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ keyId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const auth = await authenticateStorageRequest(request, "storage:admin", {
      allowMasterWriteDeleteForAdmin: true,
    });
    await checkStorageRateLimit(auth.tenant.id, "api_key", headers);

    const { keyId } = await context.params;

    const service = getStorageService();
    await service.revokeApiKey(auth.tenant.id, keyId);

    return jsonOk(
      { message: `API key '${keyId}' revoked successfully.` },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
