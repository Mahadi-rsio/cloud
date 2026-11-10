import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1, "Key name is required").max(100),
  environment: z.enum(["live", "test"]).optional().default("live"),
  projectId: z.string().trim().optional(),
  scopes: z.union([z.array(z.string()), z.string()]).optional().default("storage:read,storage:write"),
  expiresInDays: z.number().int().positive().max(365).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const service = getStorageService();
    const keys = await service.listApiKeys(auth.tenant.id);

    return jsonOk({ keys });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:write");
    const body = createApiKeyBodySchema.parse(await readJson(request));

    const service = getStorageService();
    const { apiKey, secretKey } = await service.createApiKey({
      tenantId: auth.tenant.id,
      name: body.name,
      environment: body.environment,
      projectId: body.projectId,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
    });

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
    );
  } catch (error) {
    return errorResponse(error);
  }
}
