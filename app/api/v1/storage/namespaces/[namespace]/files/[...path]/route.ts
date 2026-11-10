import type { NextRequest } from "next/server";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { authenticateStorageRequest } from "@/lib/storage/request-auth";
import { getStorageService } from "@/lib/storage/service";
import { addRateLimitHeaders, endOfCurrentHour } from "@/lib/storage/rate-limit-headers";

type RouteContext = { params: Promise<{ namespace: string; path: string[] }> };

/** Maximum allowed upload size: 100 MB */
const MAX_UPLOAD_BYTES = 104_857_600;

/**
 * Content types that browsers may execute or render as markup.
 * For user-uploaded objects of these types we override Content-Type with
 * application/octet-stream and force a download disposition so that a
 * GET response served from this API origin cannot be used for XSS.
 */
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
  // Compare only the MIME type part, ignore parameters like "; charset=utf-8"
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

/** Adds the standard static rate-limit headers to `headers`. */
function applyRateLimitHeaders(headers: Headers): void {
  addRateLimitHeaders(headers, 1000, 999, endOfCurrentHour());
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:read");
    const { namespace, path: pathSegments } = await context.params;
    const filePath = pathSegments.join("/");
    const filename = pathSegments[pathSegments.length - 1] || "file";

    // -----------------------------------------------------------------------
    // Conditional request handling — check before fetching the object body
    // -----------------------------------------------------------------------
    // We fetch metadata first (HEAD) so we can respond 304 without streaming.
    const service = getStorageService();
    const meta = await service.headFile(auth.tenant, namespace, filePath);

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      // ETag comparison (weak / strong)
      const clientEtags = ifNoneMatch.split(",").map((e) => e.trim().replace(/^W\//, ""));
      const serverEtag = meta.etag.replace(/^W\//, "");
      if (clientEtags.includes(serverEtag) || clientEtags.includes("*")) {
        const h304 = new Headers();
        applyRateLimitHeaders(h304);
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && meta.uploaded <= clientDate) {
        const h304 = new Headers();
        applyRateLimitHeaders(h304);
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    // -----------------------------------------------------------------------
    // Fetch the actual object (with optional range)
    // -----------------------------------------------------------------------
    const range = parseRangeHeader(request.headers.get("range"));
    const downloaded = await service.downloadFile(auth.tenant, namespace, filePath, { range });
    const { object } = downloaded;

    // -----------------------------------------------------------------------
    // Build response headers
    // -----------------------------------------------------------------------
    const headers = new Headers();

    const rawContentType = object.httpMetadata?.contentType;
    const url = new URL(request.url);
    const isExplicitDownload = url.searchParams.get("download") === "true";

    if (!isExplicitDownload && isUnsafeContentType(rawContentType)) {
      // Force safe content type to prevent XSS from user-supplied HTML/SVG/XML
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

    // Safety headers
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "private, no-transform");

    applyRateLimitHeaders(headers);

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

    // -----------------------------------------------------------------------
    // Max object size enforcement — check BEFORE consuming body
    // -----------------------------------------------------------------------
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = parseInt(contentLengthHeader, 10);
      if (!isNaN(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
        throw new HttpError(
          "VALIDATION_ERROR",
          "File exceeds maximum upload size of 100 MB.",
          413,
        );
      }
    }

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

    // -----------------------------------------------------------------------
    // Idempotency key — store in customMetadata so it persists on the object
    // -----------------------------------------------------------------------
    const idempotencyKey = request.headers.get("idempotency-key");
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
      },
    );

    const responseHeaders = new Headers();
    if (idempotencyKey) {
      responseHeaders.set("Idempotency-Key", idempotencyKey);
    }
    applyRateLimitHeaders(responseHeaders);

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

    // -----------------------------------------------------------------------
    // Conditional request handling for HEAD
    // -----------------------------------------------------------------------
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch) {
      const clientEtags = ifNoneMatch.split(",").map((e) => e.trim().replace(/^W\//, ""));
      const serverEtag = meta.etag.replace(/^W\//, "");
      if (clientEtags.includes(serverEtag) || clientEtags.includes("*")) {
        const h304 = new Headers();
        applyRateLimitHeaders(h304);
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    const ifModifiedSince = request.headers.get("if-modified-since");
    if (ifModifiedSince) {
      const clientDate = new Date(ifModifiedSince);
      if (!isNaN(clientDate.getTime()) && meta.uploaded <= clientDate) {
        const h304 = new Headers();
        applyRateLimitHeaders(h304);
        return new Response(null, { status: 304, headers: h304 });
      }
    }

    const headers = new Headers();
    headers.set("Content-Type", meta.httpMetadata?.contentType || "application/octet-stream");
    headers.set("Content-Length", meta.size.toString());
    headers.set("ETag", meta.etag);
    headers.set("Last-Modified", meta.uploaded.toUTCString());
    headers.set("X-Content-Type-Options", "nosniff");
    applyRateLimitHeaders(headers);

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

    const headers = new Headers();
    applyRateLimitHeaders(headers);

    return jsonOk(result, 200, headers);
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST handler — copy a file to another location. */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateStorageRequest(request, "storage:write");
    const { namespace, path: pathSegments } = await context.params;
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

    // destinationNamespace defaults to the same namespace as the source
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

    const headers = new Headers();
    applyRateLimitHeaders(headers);

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
    return errorResponse(error);
  }
}
