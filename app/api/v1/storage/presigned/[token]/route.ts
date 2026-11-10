import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { getStorageService } from "@/lib/storage/service";
import { getSecret, verifyPresignedToken } from "@/lib/storage/presign";
import { addRateLimitHeaders, endOfCurrentHour } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ token: string }> };

const MAX_UPLOAD_BYTES = 104_857_600;

const UNSAFE_CONTENT_TYPES = new Set([
  "text/html",
  "text/xml",
  "application/xml",
  "image/svg+xml",
  "application/xhtml+xml",
  "text/xsl",
]);

function isUnsafeContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return UNSAFE_CONTENT_TYPES.has(base);
}

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

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const secret = await getSecret();

    let payload;
    try {
      payload = await verifyPresignedToken(token, secret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid presigned token.";
      throw new HttpError("UNAUTHENTICATED", msg, 401);
    }

    if (payload.method !== "PUT") {
      throw new HttpError("FORBIDDEN", "This presigned token is not valid for upload (PUT).", 405);
    }

    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
        throw new HttpError("VALIDATION_ERROR", "File exceeds maximum upload size of 100 MB.", 413);
      }
    }

    if (!request.body) {
      throw new HttpError("VALIDATION_ERROR", "Request body is required for file upload.", 400);
    }

    const service = getStorageService();
    const tenant = await service.getTenant(payload.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found.", 404);
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const cacheControl = request.headers.get("cache-control") || undefined;

    const customMetadata: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      if (key.startsWith("x-storage-meta-")) {
        customMetadata[key.slice(15)] = value;
      }
    }

    const idempotencyKey = request.headers.get("idempotency-key");
    if (idempotencyKey) {
      customMetadata["idempotency-key"] = idempotencyKey;
    }

    const uploaded = await service.uploadFile(
      tenant,
      payload.namespace,
      payload.path,
      request.body,
      {
        httpMetadata: { contentType, cacheControl },
        customMetadata,
      },
    );

    const headers = new Headers();
    if (idempotencyKey) {
      headers.set("Idempotency-Key", idempotencyKey);
    }
    addRateLimitHeaders(headers, 1000, 999, endOfCurrentHour());

    return jsonOk(
      {
        namespace: uploaded.namespace,
        path: uploaded.path,
        size: uploaded.size,
        etag: uploaded.etag,
        uploadedAt: uploaded.uploaded.toISOString(),
      },
      201,
      headers,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;
    const secret = await getSecret();

    let payload;
    try {
      payload = await verifyPresignedToken(token, secret);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid presigned token.";
      throw new HttpError("UNAUTHENTICATED", msg, 401);
    }

    if (payload.method !== "GET") {
      throw new HttpError("FORBIDDEN", "This presigned token is not valid for download (GET).", 405);
    }

    const service = getStorageService();
    const tenant = await service.getTenant(payload.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found.", 404);
    }

    const meta = await service.headFile(tenant, payload.namespace, payload.path);

    // Conditional request handling
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      const clientEtags = ifNoneMatch.split(",").map((e) => e.trim().replace(/^W\//, ""));
      const serverEtag = meta.etag.replace(/^W\//, "");
      if (clientEtags.includes(serverEtag) || clientEtags.includes("*")) {
        const h304 = new Headers();
        addRateLimitHeaders(h304, 1000, 999, endOfCurrentHour());
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && meta.uploaded <= clientDate) {
        const h304 = new Headers();
        addRateLimitHeaders(h304, 1000, 999, endOfCurrentHour());
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    const range = parseRangeHeader(request.headers.get("range"));
    const downloaded = await service.downloadFile(tenant, payload.namespace, payload.path, { range });
    const { object } = downloaded;

    const pathSegments = payload.path.split("/");
    const filename = pathSegments[pathSegments.length - 1] || "file";

    const headers = new Headers();
    const rawContentType = object.httpMetadata?.contentType;
    const url = new URL(request.url);
    const isExplicitDownload = url.searchParams.get("download") === "true";

    if (!isExplicitDownload && isUnsafeContentType(rawContentType)) {
      headers.set("Content-Type", "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    } else {
      headers.set("Content-Type", rawContentType || "application/octet-stream");
      if (isExplicitDownload) {
        headers.set("Content-Disposition", `attachment; filename="${filename}"`);
      }
    }

    headers.set("Content-Length", object.size.toString());
    headers.set("ETag", object.etag);
    headers.set("Last-Modified", object.uploaded.toUTCString());
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-transform");

    addRateLimitHeaders(headers, 1000, 999, endOfCurrentHour());

    const status = range ? 206 : 200;
    return new Response(object.body as unknown as BodyInit, {
      status,
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
