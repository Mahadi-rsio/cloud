import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
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
    await checkStorageRateLimit(auth.tenant.id, "list", headers);

    const url = new URL(request.url);
    const prefix = url.searchParams.get("prefix") || undefined;
    const delimiter = url.searchParams.get("delimiter") || undefined;
    const cursor = url.searchParams.get("cursor") || undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    const service = getStorageService();
    const result = await service.listFiles(auth.tenant, namespaceName, {
      prefix,
      delimiter,
      cursor,
      limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 100, 1), 1000),
    });

    return jsonOk(
      {
        namespace: result.namespace,
        objects: result.objects.map((obj) => ({
          path: obj.path,
          key: obj.path,
          name: obj.path,
          size: obj.size,
          etag: obj.etag,
          uploaded:
            obj.uploaded instanceof Date ? obj.uploaded.toISOString() : obj.uploaded,
          httpMetadata: obj.httpMetadata,
        })),
        prefixes: result.prefixes,
        cursor: result.cursor,
        truncated: result.truncated,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
