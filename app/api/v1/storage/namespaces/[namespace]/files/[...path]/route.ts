import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService, MAX_UPLOAD_BYTES } from "@/lib/storage/service";
import { checkStorageRateLimit } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ namespace: string; path: string[] }> };

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

export interface ParsedByteRange {
  offset: number;
  length: number;
  start: number;
  end: number;
}

export function resolveByteRange(
  rangeHeader: string | null,
  totalSize: number,
): { status: "none" } | { status: "invalid" } | { status: "ok"; range: ParsedByteRange } {
  if (!rangeHeader) return { status: "none" };
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith("bytes=")) {
    return { status: "invalid" };
  }

  const spec = trimmed.slice(6).trim();
  // Reject multi-range requests or malformed syntax
  if (!spec || spec.includes(",")) {
    return { status: "invalid" };
  }

  const dashIdx = spec.indexOf("-");
  if (dashIdx === -1) {
    return { status: "invalid" };
  }

  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  if (totalSize <= 0) {
    return { status: "invalid" };
  }

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix byte-range-spec: bytes=-500
    if (!/^\d+$/.test(endStr)) return { status: "invalid" };
    const suffixLength = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { status: "invalid" };
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else {
    if (!/^\d+$/.test(startStr)) return { status: "invalid" };
    start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0 || start >= totalSize) {
      return { status: "invalid" };
    }
    if (endStr === "") {
      end = totalSize - 1;
    } else {
      if (!/^\d+$/.test(endStr)) return { status: "invalid" };
      end = parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) {
        return { status: "invalid" };
      }
      end = Math.min(end, totalSize - 1);
    }
  }

  return {
    status: "ok",
    range: {
      start,
      end,
      offset: start,
      length: end - start + 1,
    },
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace, path: pathSegments } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:read", {
      namespace,
    });
    await checkStorageRateLimit(auth.tenant.id, "read", headers);

    const filePath = pathSegments.join("/");
    const filename = pathSegments[pathSegments.length - 1] || "file";

    const service = getStorageService();
    const meta = await service.headFile(auth.tenant, namespace, filePath);

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

    const downloaded = await service.downloadFile(auth.tenant, namespace, filePath, {
      range,
    });
    const { object } = downloaded;

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

export async function PUT(request: NextRequest, context: RouteContext) {
  const responseHeaders = new Headers();
  try {
    const { namespace, path: pathSegments } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:write", {
      namespace,
    });
    await checkStorageRateLimit(auth.tenant.id, "write", responseHeaders);

    const filePath = pathSegments.join("/");

    let declaredContentLength: number | null = null;
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const parsed = parseInt(contentLengthHeader, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        declaredContentLength = parsed;
        if (parsed > MAX_UPLOAD_BYTES) {
          throw new HttpError(
            "VALIDATION_ERROR",
            "File exceeds maximum upload size of 100 MB.",
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

    const contentType = request.headers.get("content-type") || "application/octet-stream";
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

    const service = getStorageService();
    const uploaded = await service.uploadFile(
      auth.tenant,
      namespace,
      filePath,
      request.body,
      {
        httpMetadata: { contentType, cacheControl },
        customMetadata,
        declaredContentLength,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        idempotencyKey,
      },
    );

    if (idempotencyKey) {
      responseHeaders.set("Idempotency-Key", idempotencyKey);
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
      responseHeaders,
    );
  } catch (error) {
    return errorResponse(error, responseHeaders);
  }
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace, path: pathSegments } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:read", {
      namespace,
    });
    await checkStorageRateLimit(auth.tenant.id, "read", headers);

    const filePath = pathSegments.join("/");

    const service = getStorageService();
    const meta = await service.headFile(auth.tenant, namespace, filePath);

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

    headers.set("Content-Type", meta.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", meta.size.toString());
    headers.set("Accept-Ranges", "bytes");
    headers.set("ETag", meta.etag);
    headers.set("Last-Modified", meta.uploaded.toUTCString());
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(null, { status: 200, headers });
  } catch (error) {
    return errorResponse(error, headers);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace, path: pathSegments } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:delete", {
      namespace,
    });
    await checkStorageRateLimit(auth.tenant.id, "delete", headers);

    const filePath = pathSegments.join("/");

    const service = getStorageService();
    const result = await service.deleteFile(auth.tenant, namespace, filePath);

    return jsonOk(result, 200, headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const headers = new Headers();
  try {
    const { namespace, path: pathSegments } = await context.params;
    const auth = await authenticateStorageRequest(request, "storage:write", {
      namespace,
    });
    await checkStorageRateLimit(auth.tenant.id, "write", headers);

    const sourcePath = pathSegments.join("/");

    const body = await readJson(request);
    if (!body || typeof body !== "object") {
      throw new HttpError("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
    }

    const { destinationPath, destinationNamespace } = body as {
      destinationPath?: unknown;
      destinationNamespace?: unknown;
    };

    if (typeof destinationPath !== "string" || !destinationPath) {
      throw new HttpError(
        "VALIDATION_ERROR",
        "destinationPath is required and must be a non-empty string.",
        400,
      );
    }

    const dstNamespace =
      typeof destinationNamespace === "string" && destinationNamespace
        ? destinationNamespace
        : namespace;

    const service = getStorageService();
    const result = await service.copyFile(
      auth.tenant,
      namespace,
      sourcePath,
      dstNamespace,
      destinationPath,
    );

    return jsonOk(
      {
        sourcePath: result.sourcePath,
        destinationPath: result.destinationPath,
        destinationNamespace: result.destinationNamespace,
        size: result.size,
        etag: result.etag,
      },
      200,
      headers,
    );
  } catch (error) {
    return errorResponse(error, headers);
  }
}
