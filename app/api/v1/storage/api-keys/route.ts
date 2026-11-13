import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { hasScope, validateStorageScopes } from "@/lib/storage/auth";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

const createApiKeyBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Key name is required")
    .max(100, "Key name too long")
    .regex(/^[a-zA-Z0-9 _.\-]+$/, "Key name contains invalid characters"),
  environment: z.enum(["live", "test"]).optional().default("live"),
  projectId: z.string().trim().optional(),
  scopes: z
    .union([
      z.array(z.string().min(1)).min(1, "At least one scope is required"),
      z.string().min(1, "At least one scope is required"),
    ])
    .optional()
    .default("storage:read,storage:write"),
  expiresInDays: z.number().int().positive().max(365).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const headers = new Headers();
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    await checkStorageRateLimit(auth.tenant.id, "api_key", headers);

    const service = getStorageService();
    const keys = await service.listApiKeys(auth.tenant.id);

    return jsonOk({ keys }, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
}

export async function POST(request: NextRequest) {
  const headers = new Headers();
  try {
    const auth = await authenticateStorageRequest(request, "storage:admin", {
      allowMasterWriteDeleteForAdmin: true,
    });
    await checkStorageRateLimit(auth.tenant.id, "api_key", headers);

    const body = createApiKeyBodySchema.parse(await readJson(request));
    const scopeCheck = validateStorageScopes(body.scopes);
    if (!scopeCheck.valid) {
      throw new HttpError(
        "VALIDATION_ERROR",
        scopeCheck.invalidScopes.length > 0
          ? `Unsupported permission scope(s): ${scopeCheck.invalidScopes.join(", ")}`
          : "At least one valid storage permission scope is required",
        400,
      );
    }

    // Prevent privilege escalation: an API key cannot mint a new key with scopes it does not possess
    for (const requestedScope of scopeCheck.scopes) {
      if (!hasScope(auth.scopes, requestedScope)) {
        throw new HttpError(
          "FORBIDDEN",
          `Cannot grant scope '${requestedScope}' not held by caller`,
          403,
        );
      }
    }

    const service = getStorageService();
    const { apiKey, secretKey } = await service.createApiKey({
      tenantId: auth.tenant.id,
      name: body.name,
      environment: body.environment,
      projectId: body.projectId,
      scopes: scopeCheck.scopes,
      expiresInDays: body.expiresInDays,
      expiresAt: body.expiresAt,
    });

    headers.set("Cache-Control", "no-store");

    return jsonOk(
      {
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          prefix: apiKey.prefix,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expiresAt,
          createdAt: apiKey.createdAt,
        },
        secretKey,
      },
      201,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
