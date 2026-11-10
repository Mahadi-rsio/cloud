import type { NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

const createNamespaceBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Namespace name is required")
    .max(63, "Namespace name must be at most 63 characters")
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Namespace name must be lowercase alphanumeric with hyphens or dots"),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const service = getStorageService();
    const namespaces = await service.listNamespaces(auth.tenant.id);

    return jsonOk({
      tenantId: auth.tenant.id,
      namespaces: namespaces.map((ns) => ({
        id: ns.id,
        name: ns.name,
        createdAt: ns.createdAt,
        updatedAt: ns.updatedAt,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:write");
    const body = createNamespaceBodySchema.parse(await readJson(request));

    const service = getStorageService();
    const namespace = await service.createNamespace(auth.tenant.id, body.name);

    return jsonOk(
      {
        id: namespace.id,
        name: namespace.name,
        tenantId: auth.tenant.id,
        createdAt: namespace.createdAt,
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
