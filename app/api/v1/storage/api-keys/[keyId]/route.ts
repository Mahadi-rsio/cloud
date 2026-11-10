import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

type RouteContext = { params: Promise<{ keyId: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:write");
    const { keyId } = await context.params;

    const service = getStorageService();
    await service.revokeApiKey(auth.tenant.id, keyId);

    return jsonOk({ message: `API key '${keyId}' revoked successfully.` });
  } catch (error) {
    return errorResponse(error);
  }
}
