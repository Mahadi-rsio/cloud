import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { validatePath } from "@/lib/storage/keys";
import { createPresignedToken, getSecret } from "@/lib/storage/presign";
import { addRateLimitHeaders, endOfCurrentHour } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ namespace: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { namespace: namespaceName } = await context.params;

    const body = (await readJson(request)) as {
      path?: unknown;
      method?: unknown;
      expiresIn?: unknown;
    };

    if (!body || typeof body !== "object") {
      throw new HttpError("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
    }

    if (typeof body.path !== "string" || !body.path.trim()) {
      throw new HttpError("VALIDATION_ERROR", "path is required and must be a non-empty string.", 400);
    }

    const validated = validatePath(body.path);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    const method = body.method === "GET" ? "GET" : "PUT";
    const requiredScope = method === "GET" ? "storage:read" : "storage:write";

    const auth = await authenticateStorageRequest(request, requiredScope);
    const service = getStorageService();

    const namespace = await service.getNamespace(auth.tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    let expiresIn = 3600;
    if (typeof body.expiresIn === "number" && !isNaN(body.expiresIn)) {
      expiresIn = Math.min(Math.max(Math.floor(body.expiresIn), 60), 86400);
    }

    const secret = await getSecret();
    const token = await createPresignedToken(
      {
        tenantId: auth.tenant.id,
        namespace: namespace.name,
        path: validated.normalized,
        method,
      },
      secret,
      expiresIn,
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const headers = new Headers();
    addRateLimitHeaders(headers, 1000, 999, endOfCurrentHour());

    return jsonOk(
      {
        token,
        url: `/api/v1/storage/presigned/${token}`,
        method,
        namespace: namespace.name,
        path: validated.normalized,
        expiresIn,
        expiresAt,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
