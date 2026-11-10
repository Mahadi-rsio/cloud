import { jsonOk } from "@/lib/http";
import { addRateLimitHeaders, endOfCurrentHour } from "@/lib/storage/rate-limit-headers";

export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Cloud Object Storage API",
      version: "1.0.0",
      description:
        "High-performance, multi-tenant object storage backed by Cloudflare R2 and Neon PostgreSQL. Authenticated with Better Auth API keys.",
    },
    servers: [
      {
        url: "/api/v1/storage",
        description: "Control plane storage endpoint",
      },
    ],
    components: {
      securitySchemes: {
        ApiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "Better Auth API Key",
        },
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Better Auth API Key as Bearer token",
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                code: { type: "string", example: "VALIDATION_ERROR" },
                message: { type: "string" },
                details: { type: "object" },
              },
              required: ["code", "message"],
            },
          },
        },
        Namespace: {
          type: "object",
          properties: {
            id: { type: "string", example: "p_01j7..." },
            tenantId: { type: "string", example: "t_01j7..." },
            name: { type: "string", example: "my-bucket" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        StoredObject: {
          type: "object",
          properties: {
            path: { type: "string", example: "photos/banner.png" },
            size: { type: "integer", example: 1048576 },
            etag: { type: "string", example: "\"d41d8cd98f00b204e9800998ecf8427e\"" },
            uploaded: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }],
    paths: {
      "/namespaces": {
        get: {
          summary: "List all namespaces in current tenant",
          responses: {
            "200": { description: "List of namespaces" },
            "401": { description: "Unauthenticated" },
          },
        },
        post: {
          summary: "Create a new namespace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", minLength: 1, maxLength: 100 },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Namespace created" },
            "409": { description: "Namespace already exists" },
          },
        },
      },
      "/namespaces/{namespace}": {
        get: {
          summary: "Get namespace details",
          parameters: [{ name: "namespace", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Namespace details" }, "404": { description: "Not found" } },
        },
        delete: {
          summary: "Delete namespace and all its files",
          parameters: [{ name: "namespace", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Namespace deleted" }, "404": { description: "Not found" } },
        },
      },
      "/namespaces/{namespace}/files": {
        get: {
          summary: "List files within a namespace",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "prefix", in: "query", schema: { type: "string" } },
            { name: "delimiter", in: "query", schema: { type: "string" } },
            { name: "cursor", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 1000 } },
          ],
          responses: { "200": { description: "List of files and common prefixes" } },
        },
      },
      "/namespaces/{namespace}/files/{path}": {
        put: {
          summary: "Upload a file (streamed binary, up to 100 MB)",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "path", in: "path", required: true, schema: { type: "string" } },
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "*/*": { schema: { type: "string", format: "binary" } } },
          },
          responses: {
            "201": { description: "File uploaded successfully" },
            "413": { description: "File exceeds 100 MB limit" },
          },
        },
        get: {
          summary: "Download a file (supports Range and conditional requests)",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "path", in: "path", required: true, schema: { type: "string" } },
            { name: "If-None-Match", in: "header", schema: { type: "string" } },
            { name: "If-Modified-Since", in: "header", schema: { type: "string" } },
            { name: "Range", in: "header", schema: { type: "string" } },
            { name: "download", in: "query", schema: { type: "boolean" } },
          ],
          responses: {
            "200": { description: "Full file contents" },
            "206": { description: "Partial content (Range)" },
            "304": { description: "Not Modified" },
            "404": { description: "Not found" },
          },
        },
        head: {
          summary: "Check file metadata and ETag",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "path", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "File exists" }, "404": { description: "Not found" } },
        },
        delete: {
          summary: "Delete a file",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "path", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "File deleted" } },
        },
        post: {
          summary: "Copy a file to another path or namespace",
          parameters: [
            { name: "namespace", in: "path", required: true, schema: { type: "string" } },
            { name: "path", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["destinationPath"],
                  properties: {
                    destinationPath: { type: "string" },
                    destinationNamespace: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "File copied" } },
        },
      },
      "/namespaces/{namespace}/presign": {
        post: {
          summary: "Create a short-lived presigned upload/download token",
          parameters: [{ name: "namespace", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["path"],
                  properties: {
                    path: { type: "string" },
                    method: { type: "string", enum: ["GET", "PUT"], default: "PUT" },
                    expiresIn: { type: "integer", default: 3600, maximum: 86400 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Presigned token and proxy URL" } },
        },
      },
      "/presigned/{token}": {
        put: {
          summary: "Direct upload via presigned token (no API key required)",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "*/*": { schema: { type: "string", format: "binary" } } },
          },
          responses: { "201": { description: "File uploaded" }, "401": { description: "Token expired or invalid" } },
        },
        get: {
          summary: "Direct download via presigned token (no API key required)",
          parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "File stream" }, "401": { description: "Token expired or invalid" } },
        },
      },
    },
  };

  const headers = new Headers();
  headers.set("Cache-Control", "public, max-age=3600");
  addRateLimitHeaders(headers, 1000, 999, endOfCurrentHour());

  return jsonOk(spec, 200, headers);
}
