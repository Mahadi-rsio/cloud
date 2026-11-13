import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ namespace: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace: namespaceName } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:read", {
      namespace: namespaceName,
    });
    await checkStorageRateLimit(auth.tenant.id, "read", headers);

    const service = getStorageService();
    const namespace = await service.getNamespace(auth.tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const files = await service.listFiles(auth.tenant, namespace.name, { limit: 1000 });
    const totalBytes = files.objects.reduce((sum, obj) => sum + obj.size, 0);

    return jsonOk(
      {
        id: namespace.id,
        name: namespace.name,
        tenantId: auth.tenant.id,
        objectCount: files.objects.length,
        totalBytes,
        createdAt: namespace.createdAt,
        updatedAt: namespace.updatedAt,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace: namespaceName } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:admin", {
      namespace: namespaceName,
      allowMasterWriteDeleteForAdmin: true,
    });
    await checkStorageRateLimit(auth.tenant.id, "namespace", headers);

    const service = getStorageService();
    await service.deleteNamespace(auth.tenant.id, namespaceName);

    return jsonOk(
      {
        message: `Namespace '${namespaceName}' and all stored objects deleted successfully.`,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
