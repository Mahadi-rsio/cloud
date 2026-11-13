import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { getStorageService, MAX_UPLOAD_BYTES } from "@/lib/storage/service";
import {
  getSecret,
  markPresignedTokenConsumed,
  verifyPresignedToken,
} from "@/lib/storage/presign";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";
import { resolveByteRange } from "@/app/api/v1/storage/namespaces/[namespace]/files/[...path]/route";

type RouteContext = { params: Promise<{ token: string }> };

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

export async function PUT(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");

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
      throw new HttpError(
        "FORBIDDEN",
        "This presigned token is not valid for upload (PUT).",
        405,
      );
    }

    if (!markPresignedTokenConsumed(payload)) {
      throw new HttpError(
        "FORBIDDEN",
        "This single-use presigned token has already been used.",
        403,
      );
    }

    await checkStorageRateLimit(payload.tenantId, "write", headers);

    const maxAllowedBytes = payload.maxSizeBytes
      ? Math.min(payload.maxSizeBytes, MAX_UPLOAD_BYTES)
      : MAX_UPLOAD_BYTES;

    let declaredContentLength: number | null = null;
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength >= 0) {
        declaredContentLength = contentLength;
        if (contentLength > maxAllowedBytes) {
          throw new HttpError(
            "VALIDATION_ERROR",
            `File exceeds maximum upload size of ${Math.round(maxAllowedBytes / (1024 * 1024))} MB.`,
            413,
          );
        }
      }
    }

    if (!request.body) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "Request body is required for file upload.",
        400,
      );
    }

    const service = getStorageService();
    const tenant = await service.getTenant(payload.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found.", 404);
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    if (payload.contentType) {
      const expectedBase = payload.contentType.split(";")[0]?.trim().toLowerCase();
      const actualBase = contentType.split(";")[0]?.trim().toLowerCase();
      if (expectedBase && actualBase !== expectedBase) {
        throw new HttpError(
          "VALIDATION_ERROR",
          `Content-Type '${contentType}' does not match presigned constraint '${payload.contentType}'.`,
          400,
        );
      }
    }

    const cacheControl = request.headers.get("cache-control") || undefined;

    const customMetadata: Record<string, string> = {};
    for (const [key, value] of request.headers.entries()) {
      if (key.startsWith("x-storage-meta-")) {
        customMetadata[key.slice(15)] = value;
      }
    }

    const idempotencyKey = request.headers.get("idempotency-key") || undefined;
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
        declaredContentLength,
        maxUploadBytes: maxAllowedBytes,
        idempotencyKey,
      },
    );

    if (idempotencyKey) {
      headers.set("Idempotency-Key", idempotencyKey);
    }

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
    return errorResponse(error, headers);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  headers.set("Referrer-Policy", "no-referrer");

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
      throw new HttpError(
        "FORBIDDEN",
        "This presigned token is not valid for download (GET).",
        405,
      );
    }

    if (!markPresignedTokenConsumed(payload)) {
      throw new HttpError(
        "FORBIDDEN",
        "This single-use presigned token has already been used.",
        403,
      );
    }

    await checkStorageRateLimit(payload.tenantId, "read", headers);

    const service = getStorageService();
    const tenant = await service.getTenant(payload.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found.", 404);
    }

    const meta = await service.headFile(tenant, payload.namespace, payload.path);

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      const clientEtags = ifNoneMatch.split(",").map((e) => e.trim().replace(/^W\//, ""));
      const serverEtag = meta.etag.replace(/^W\//, "");
      if (clientEtags.includes(serverEtag) || clientEtags.includes("*")) {
        headers.set("ETag", meta.etag);
        return new Response(null, { status: 304, headers });
      }
    }

    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && meta.uploaded <= clientDate) {
        headers.set("ETag", meta.etag);
        return new Response(null, { status: 304, headers });
      }
    }

    const rangeResolution = resolveByteRange(request.headers.get("range"), meta.size);
    if (rangeResolution.status === "invalid") {
      headers.set("Content-Range", `bytes */${meta.size}`);
      headers.set("Accept-Ranges", "bytes");
      return new Response(null, { status: 416, headers });
    }

    const range =
      rangeResolution.status === "ok"
        ? { offset: rangeResolution.range.offset, length: rangeResolution.range.length }
        : undefined;

    const downloaded = await service.downloadFile(
      tenant,
      payload.namespace,
      payload.path,
      { range },
    );
    const { object } = downloaded;

    const pathSegments = payload.path.split("/");
    const filename = pathSegments[pathSegments.length - 1] || "file";

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
    headers.set("Accept-Ranges", "bytes");
    headers.set("ETag", object.etag);
    headers.set("Last-Modified", object.uploaded.toUTCString());
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-transform");

    if (rangeResolution.status === "ok") {
      headers.set(
        "Content-Range",
        `bytes ${rangeResolution.range.start}-${rangeResolution.range.end}/${meta.size}`,
      );
    }

    const status = rangeResolution.status === "ok" ? 206 : 200;
    return new Response(object.body as unknown as BodyInit, {
      status,
      headers,
    });
  } catch (error) {
    return errorResponse(error, headers);
  }
}
