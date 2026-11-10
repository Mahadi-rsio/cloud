import type { NextRequest } from "next/server";
import { errorResponse, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

type RouteContext = { params: Promise<{ namespace: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const { namespace: namespaceName } = await context.params;

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
      limit: Math.min(Math.max(limit, 1), 1000),
    });

    return jsonOk({
      namespace: result.namespace,
      objects: result.objects,
      prefixes: result.prefixes,
      cursor: result.cursor,
      truncated: result.truncated,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
