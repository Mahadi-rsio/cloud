import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { validatePath } from "@/lib/storage/keys";
import { createPresignedToken, getSecret } from "@/lib/storage/presign";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ namespace: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");

  try {
    const { namespace: namespaceName } = await context.params;

    const body = (await readJson(request)) as {
      path?: unknown;
      method?: unknown;
      expiresIn?: unknown;
      expiresInSeconds?: unknown;
      contentType?: unknown;
      maxSizeBytes?: unknown;
      singleUse?: unknown;
    };

    if (!body || typeof body !== "object") {
      throw new HttpError("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
    }

    if (typeof body.path !== "string" || !body.path.trim()) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "path is required and must be a non-empty string.",
        400,
      );
    }

    const validated = validatePath(body.path);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    let method: "GET" | "PUT" = "PUT";
    if (body.method !== undefined) {
      if (body.method !== "GET" && body.method !== "PUT") {
        throw new HttpError(
          "VALIDATION_ERROR",
          "method must be either 'GET' or 'PUT'.",
          400,
        );
      }
      method = body.method;
    }

    const requiredScope = method === "GET" ? "storage:read" : "storage:write";
    const auth = await authenticateStorageRequest(request, requiredScope, {
      namespace: namespaceName,
    });
    await checkStorageRateLimit(auth.tenant.id, "presign", headers);

    const service = getStorageService();
    const namespace = await service.getNamespace(auth.tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    let expiresIn = 3600;
    const rawExpires = body.expiresIn ?? body.expiresInSeconds;
    if (typeof rawExpires === "number" && Number.isFinite(rawExpires)) {
      if (rawExpires <= 0 || rawExpires > 86400) {
        throw new HttpError(
          "VALIDATION_ERROR",
          "expiresIn must be between 1 and 86400 seconds.",
          400,
        );
      }
      expiresIn = Math.min(Math.max(Math.floor(rawExpires), 60), 86400);
    }

    const contentType =
      typeof body.contentType === "string" && body.contentType.trim()
        ? body.contentType.trim()
        : undefined;
    const maxSizeBytes =
      typeof body.maxSizeBytes === "number" &&
      Number.isFinite(body.maxSizeBytes) &&
      body.maxSizeBytes > 0
        ? Math.min(Math.floor(body.maxSizeBytes), 100 * 1024 * 1024)
        : undefined;
    const singleUse = Boolean(body.singleUse);

    const secret = await getSecret();
    const token = await createPresignedToken(
      {
        tenantId: auth.tenant.id,
        namespace: namespace.name,
        path: validated.normalized,
        method,
        contentType,
        maxSizeBytes,
        singleUse,
      },
      secret,
      expiresIn,
    );

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await service.recordAudit({
      tenantId: auth.tenant.id,
      actorType: auth.apiKey ? "api_key" : "user",
      actorId: auth.apiKey?.id ?? auth.user?.id ?? "unknown",
      action: `presign.${method.toLowerCase()}`,
      resourceType: "object",
      resourceId: `${namespace.name}/${validated.normalized}`,
      metadata: JSON.stringify({ method, expiresIn, singleUse }),
    });

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
    return errorResponse(error, headers);
  }
}
