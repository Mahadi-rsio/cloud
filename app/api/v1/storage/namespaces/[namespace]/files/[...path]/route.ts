import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";

type RouteContext = { params: Promise<{ namespace: string; path: string[] }> };

function parseRangeHeader(
  rangeHeader: string | null,
): { offset?: number; length?: number } | undefined {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return undefined;

  const parts = rangeHeader.slice(6).split("-");
  const start = parts[0] ? parseInt(parts[0], 10) : undefined;
  const end = parts[1] ? parseInt(parts[1], 10) : undefined;

  if (start !== undefined && end !== undefined) {
    return { offset: start, length: end - start + 1 };
  }
  if (start !== undefined) {
    return { offset: start };
  }
  return undefined;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const { namespace, path: pathSegments } = await context.params;
    const filePath = pathSegments.join("/");

    const range = parseRangeHeader(request.headers.get("range"));
    const service = getStorageService();

    const downloaded = await service.downloadFile(auth.tenant, namespace, filePath, { range });
    const { object } = downloaded;

    const headers = new Headers();
    if (object.httpMetadata?.contentType) {
      headers.set("Content-Type", object.httpMetadata.contentType);
    } else {
      headers.set("Content-Type", "application/octet-stream");
    }

    headers.set("Content-Length", object.size.toString());
    headers.set("ETag", object.etag);
    headers.set("Last-Modified", object.uploaded.toUTCString());

    const url = new URL(request.url);
    if (url.searchParams.get("download") === "true") {
      const filename = pathSegments[pathSegments.length - 1] || "file";
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    }

    const status = range ? 206 : 200;
    return new Response(object.body as unknown as BodyInit, {
      status,
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:write");
    const { namespace, path: pathSegments } = await context.params;
    const filePath = pathSegments.join("/");

    if (!request.body) {
      throw new HttpError("VALIDATION_ERROR", "Request body is required for file upload.", 400);
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const cacheControl = request.headers.get("cache-control") || undefined;

    // Extract custom metadata (x-storage-meta-*)
    const customMetadata: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      if (key.startsWith("x-storage-meta-")) {
        customMetadata[key.slice(15)] = value;
      }
    }

    const service = getStorageService();
    const uploaded = await service.uploadFile(
      auth.tenant,
      namespace,
      filePath,
      request.body,
      {
        httpMetadata: { contentType, cacheControl },
        customMetadata,
      },
    );

    return jsonOk(
      {
        namespace: uploaded.namespace,
        path: uploaded.path,
        size: uploaded.size,
        etag: uploaded.etag,
        uploadedAt: uploaded.uploaded.toISOString(),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const { namespace, path: pathSegments } = await context.params;
    const filePath = pathSegments.join("/");

    const service = getStorageService();
    const meta = await service.headFile(auth.tenant, namespace, filePath);

    const headers = new Headers();
    headers.set("Content-Type", meta.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", meta.size.toString());
    headers.set("ETag", meta.etag);
    headers.set("Last-Modified", meta.uploaded.toUTCString());

    return new Response(null, { status: 200, headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:delete");
    const { namespace, path: pathSegments } = await context.params;
    const filePath = pathSegments.join("/");

    const service = getStorageService();
    const result = await service.deleteFile(auth.tenant, namespace, filePath);

    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}
