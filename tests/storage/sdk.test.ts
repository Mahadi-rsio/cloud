import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetStorageDb } from "@/lib/storage/db";
import { resetMemoryStorageBucket } from "@/lib/storage/r2";
import { getStorageService } from "@/lib/storage/service";
import { GET as getUsageRoute } from "@/app/api/v1/storage/usage/route";
import { GET as getTenantRoute } from "@/app/api/v1/storage/tenants/route";
import {
  GET as listNamespacesRoute,
  POST as createNamespaceRoute,
} from "@/app/api/v1/storage/namespaces/route";
import {
  GET as getNamespaceRoute,
  DELETE as deleteNamespaceRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/route";
import { GET as listFilesRoute } from "@/app/api/v1/storage/namespaces/[namespace]/files/route";
import {
  GET as downloadFileRoute,
  PUT as uploadFileRoute,
  HEAD as headFileRoute,
  DELETE as deleteFileRoute,
  POST as copyFileRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/files/[...path]/route";
import { POST as presignRoute } from "@/app/api/v1/storage/namespaces/[namespace]/presign/route";
import {
  GET as presignedDownloadRoute,
  PUT as presignedUploadRoute,
} from "@/app/api/v1/storage/presigned/[token]/route";
import {
  GET as listApiKeysRoute,
  POST as createApiKeyRoute,
} from "@/app/api/v1/storage/api-keys/route";
import { DELETE as revokeApiKeyRoute } from "@/app/api/v1/storage/api-keys/[keyId]/route";
import {
  createStorageClient,
  StorageApiError,
  StorageClient,
} from "@/packages/storage-sdk/src/index";

function jsonOkResponse(data: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function createRouteDispatchFetch(): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = rawUrl.startsWith("http") ? new URL(rawUrl) : new URL(rawUrl, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();

    const nextReq = new NextRequest(url.toString(), {
      method,
      headers: init?.headers,
      body: init?.body as BodyInit | null | undefined,
      ...(init?.body && typeof ReadableStream !== "undefined" && init.body instanceof ReadableStream
        ? { duplex: "half" }
        : {}),
    } as RequestInit & { duplex?: "half" });

    const pathname = url.pathname;

    if (pathname === "/api/v1/storage/usage" && method === "GET") {
      return getUsageRoute(nextReq);
    }
    if (pathname === "/api/v1/storage/tenants" && method === "GET") {
      return getTenantRoute(nextReq);
    }
    if (pathname === "/api/v1/storage/namespaces") {
      if (method === "GET") return listNamespacesRoute(nextReq);
      if (method === "POST") return createNamespaceRoute(nextReq);
    }
    if (pathname === "/api/v1/storage/api-keys") {
      if (method === "GET") return listApiKeysRoute(nextReq);
      if (method === "POST") return createApiKeyRoute(nextReq);
    }
    const apiKeyMatch = pathname.match(/^\/api\/v1\/storage\/api-keys\/([^/]+)$/);
    if (apiKeyMatch && method === "DELETE") {
      return revokeApiKeyRoute(nextReq, {
        params: Promise.resolve({ keyId: decodeURIComponent(apiKeyMatch[1]) }),
      });
    }

    const presignedMatch = pathname.match(/^\/api\/v1\/storage\/presigned\/([^/]+)$/);
    if (presignedMatch) {
      const ctx = { params: Promise.resolve({ token: decodeURIComponent(presignedMatch[1]) }) };
      if (method === "PUT") return presignedUploadRoute(nextReq, ctx);
      if (method === "GET") return presignedDownloadRoute(nextReq, ctx);
    }

    const nsPresignMatch = pathname.match(/^\/api\/v1\/storage\/namespaces\/([^/]+)\/presign$/);
    if (nsPresignMatch && method === "POST") {
      return presignRoute(nextReq, {
        params: Promise.resolve({ namespace: decodeURIComponent(nsPresignMatch[1]) }),
      });
    }

    const nsFilesListMatch = pathname.match(/^\/api\/v1\/storage\/namespaces\/([^/]+)\/files$/);
    if (nsFilesListMatch && method === "GET") {
      return listFilesRoute(nextReq, {
        params: Promise.resolve({ namespace: decodeURIComponent(nsFilesListMatch[1]) }),
      });
    }

    const nsFileMatch = pathname.match(/^\/api\/v1\/storage\/namespaces\/([^/]+)\/files\/(.+)$/);
    if (nsFileMatch) {
      const namespace = decodeURIComponent(nsFileMatch[1]);
      const path = nsFileMatch[2].split("/").map((s) => decodeURIComponent(s));
      const ctx = { params: Promise.resolve({ namespace, path }) };
      if (method === "GET") return downloadFileRoute(nextReq, ctx);
      if (method === "PUT") return uploadFileRoute(nextReq, ctx);
      if (method === "HEAD") return headFileRoute(nextReq, ctx);
      if (method === "DELETE") return deleteFileRoute(nextReq, ctx);
      if (method === "POST") return copyFileRoute(nextReq, ctx);
    }

    const nsMatch = pathname.match(/^\/api\/v1\/storage\/namespaces\/([^/]+)$/);
    if (nsMatch) {
      const ctx = { params: Promise.resolve({ namespace: decodeURIComponent(nsMatch[1]) }) };
      if (method === "GET") return getNamespaceRoute(nextReq, ctx);
      if (method === "DELETE") return deleteNamespaceRoute(nextReq, ctx);
    }

    return new Response(JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: `No route for ${method} ${pathname}` } }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

describe("@cloud/storage TypeScript SDK", () => {
  describe("Unit tests (mocked fetch)", () => {
    it("normalizes baseUrl and sends x-api-key or bearer auth headers", async () => {
      const calls: Array<{ url: string; headers: Headers; method: string }> = [];
      const mockFetch: typeof globalThis.fetch = async (input, init) => {
        calls.push({
          url: String(input),
          headers: new Headers(init?.headers),
          method: init?.method ?? "GET",
        });
        return jsonOkResponse({ tenantId: "t_1", namespaces: [] });
      };

      const clientA = createStorageClient({
        baseUrl: "https://storage.example.com/",
        apiKey: "sk_live_abc",
        fetch: mockFetch,
      });
      await clientA.namespaces.list();

      const clientB = new StorageClient({
        baseUrl: "https://storage.example.com/api/v1/storage",
        apiKey: "sk_live_xyz",
        authHeader: "bearer",
        fetch: mockFetch,
      });
      await clientB.namespaces.list();

      expect(calls[0].url).toBe("https://storage.example.com/api/v1/storage/namespaces");
      expect(calls[0].headers.get("x-api-key")).toBe("sk_live_abc");
      expect(calls[0].headers.get("authorization")).toBeNull();

      expect(calls[1].url).toBe("https://storage.example.com/api/v1/storage/namespaces");
      expect(calls[1].headers.get("authorization")).toBe("Bearer sk_live_xyz");
      expect(calls[1].headers.get("x-api-key")).toBeNull();
    });

    it("requires default namespace for top-level object methods unless configured", () => {
      const client = createStorageClient({ fetch: async () => jsonOkResponse({}) });
      expect(() => client.upload("a.txt", "hello")).toThrow(/No default namespace configured/);
    });

    it("uploads with metadata, idempotencyKey, and custom contentType", async () => {
      let capturedHeaders = new Headers();
      let capturedUrl = "";
      const mockFetch: typeof globalThis.fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = new Headers(init?.headers);
        return jsonOkResponse(
          {
            namespace: "assets",
            path: "docs/hello world.txt",
            size: 5,
            etag: '"etag1"',
            uploadedAt: "2026-11-14T12:00:00.000Z",
          },
          201,
        );
      };

      const storage = createStorageClient({
        baseUrl: "https://storage.example.com",
        apiKey: "sk_live_1",
        namespace: "assets",
        fetch: mockFetch,
      });

      const res = await storage.upload("/docs/hello world.txt", "hello", {
        contentType: "text/plain",
        cacheControl: "max-age=60",
        idempotencyKey: "idem-123",
        metadata: { author: "alice" },
      });

      expect(capturedUrl).toBe(
        "https://storage.example.com/api/v1/storage/namespaces/assets/files/docs/hello%20world.txt",
      );
      expect(capturedHeaders.get("content-type")).toBe("text/plain");
      expect(capturedHeaders.get("cache-control")).toBe("max-age=60");
      expect(capturedHeaders.get("idempotency-key")).toBe("idem-123");
      expect(capturedHeaders.get("x-storage-meta-author")).toBe("alice");
      expect(res.etag).toBe('"etag1"');
    });

    it("supports listAll async pagination across cursors", async () => {
      const cursorsSeen: Array<string | null> = [];
      const mockFetch: typeof globalThis.fetch = async (input) => {
        const url = new URL(String(input), "https://storage.example.com");
        const cursor = url.searchParams.get("cursor");
        cursorsSeen.push(cursor);

        if (!cursor) {
          return jsonOkResponse({
            namespace: "assets",
            objects: [
              { path: "a.txt", key: "a.txt", name: "a.txt", size: 1, etag: '"1"', uploaded: "2026-11-14T00:00:00Z" },
            ],
            prefixes: [],
            cursor: "page-2",
            truncated: true,
          });
        }

        return jsonOkResponse({
          namespace: "assets",
          objects: [
            { path: "b.txt", key: "b.txt", name: "b.txt", size: 2, etag: '"2"', uploaded: "2026-11-14T00:00:00Z" },
          ],
          prefixes: [],
          truncated: false,
        });
      };

      const client = createStorageClient({
        baseUrl: "https://storage.example.com",
        apiKey: "sk_live_1",
        fetch: mockFetch,
      });

      const items: string[] = [];
      for await (const obj of client.namespace("assets").listAll("docs/", { limit: 1 })) {
        items.push(obj.path);
      }

      expect(cursorsSeen).toEqual([null, "page-2"]);
      expect(items).toEqual(["a.txt", "b.txt"]);
    });

    it("parses StorageApiError and rate-limit headers", async () => {
      const mockFetch: typeof globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests",
              details: { window: "1h" },
            },
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "X-RateLimit-Limit": "100",
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": "1700000000",
              "Retry-After": "42",
            },
          },
        );

      const client = createStorageClient({
        baseUrl: "https://storage.example.com",
        apiKey: "sk_live_1",
        fetch: mockFetch,
      });

      let caught: unknown;
      try {
        await client.getUsage();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(StorageApiError);
      const apiErr = caught as StorageApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.code).toBe("RATE_LIMITED");
      expect(apiErr.message).toBe("Too many requests");
      expect(apiErr.details).toEqual({ window: "1h" });
      expect(apiErr.rateLimit).toEqual({
        limit: 100,
        remaining: 0,
        resetAt: 1700000000,
        retryAfterSeconds: 42,
      });
    });

    it("does not send API key headers on presigned upload/download", async () => {
      const capturedHeaders: Headers[] = [];
      const mockFetch: typeof globalThis.fetch = async (_input, init) => {
        capturedHeaders.push(new Headers(init?.headers));
        if ((init?.method ?? "GET") === "PUT") {
          return jsonOkResponse(
            {
              namespace: "assets",
              path: "file.txt",
              size: 4,
              etag: '"p1"',
              uploadedAt: "2026-11-14T00:00:00Z",
            },
            201,
          );
        }
        return new Response("data", { status: 200 });
      };

      const client = createStorageClient({
        baseUrl: "https://storage.example.com",
        apiKey: "sk_live_secret",
        fetch: mockFetch,
      });

      await client.presigned.upload("tok_123", "data", { contentType: "text/plain" });
      const dl = await client.presigned.download("/api/v1/storage/presigned/tok_123");

      expect(capturedHeaders[0].get("x-api-key")).toBeNull();
      expect(capturedHeaders[1].get("x-api-key")).toBeNull();
      expect(await dl.text()).toBe("data");
    });
  });

  describe("End-to-end integration against Next.js storage route handlers", () => {
    let adminApiKey = "";

    beforeEach(async () => {
      resetStorageDb();
      resetMemoryStorageBucket();

      const service = getStorageService();
      const tenant = await service.createTenant({
        name: "SDK Integration Tenant",
        plan: "free",
      });
      const created = await service.createApiKey({
        tenantId: tenant.id,
        name: "sdk-admin",
        environment: "live",
        scopes: ["storage:read", "storage:write", "storage:delete", "storage:admin"],
      });
      adminApiKey = created.secretKey;
    });

    it("performs full lifecycle: namespaces, upload, head, exists, range/conditional download, copy, list, presign, delete, usage, apiKeys", async () => {
      const client = createStorageClient({
        baseUrl: "http://localhost",
        apiKey: adminApiKey,
        fetch: createRouteDispatchFetch(),
      });

      // 1. Create & inspect namespace
      const ns = await client.namespaces.create("sdk-bucket");
      expect(ns.name).toBe("sdk-bucket");

      const nsList = await client.namespaces.list();
      expect(nsList.map((n) => n.name)).toContain("sdk-bucket");

      const storage = client.namespace("sdk-bucket");

      // 2. Upload object
      const uploadRes = await storage.upload("hello/world.json", JSON.stringify({ ok: true, msg: "hi" }), {
        contentType: "application/json",
        idempotencyKey: "upload-1",
      });
      expect(uploadRes.path).toBe("hello/world.json");
      expect(uploadRes.size).toBeGreaterThan(0);

      // 3. Head & exists
      expect(await storage.exists("hello/world.json")).toBe(true);
      expect(await storage.exists("hello/missing.json")).toBe(false);

      const headRes = await storage.head("hello/world.json");
      expect(headRes.status).toBe(200);
      expect(headRes.etag).toBeTruthy();
      expect(headRes.contentType).toBe("application/json");

      // 4. Full download, conditional 304, and partial range 206
      const full = await storage.download("hello/world.json");
      expect(full.status).toBe(200);
      expect(await full.json()).toEqual({ ok: true, msg: "hi" });

      const notModified = await storage.download("hello/world.json", {
        ifNoneMatch: full.etag!,
      });
      expect(notModified.status).toBe(304);
      expect(notModified.notModified).toBe(true);

      const partial = await storage.download("hello/world.json", {
        range: { start: 0, end: 4 },
      });
      expect(partial.status).toBe(206);
      expect(await partial.text()).toBe('{"ok"');

      // 5. Copy & list
      const copied = await storage.copy("hello/world.json", "backup/world.json");
      expect(copied.destinationPath).toBe("backup/world.json");

      const listed = await storage.list({ prefix: "backup/" });
      expect(listed.objects.map((o) => o.path)).toEqual(["backup/world.json"]);

      // 6. Presigned upload & download
      const presignedPut = await storage.createPresignedUrl("presigned/note.txt", {
        action: "write",
        expiresIn: 300,
        contentType: "text/plain",
        singleUse: true,
      });
      expect(presignedPut.url).toMatch(/^http:\/\/localhost\/api\/v1\/storage\/presigned\//);

      const putRes = await client.presigned.upload(presignedPut.url, "presigned content", {
        contentType: "text/plain",
      });
      expect(putRes.path).toBe("presigned/note.txt");

      const presignedGet = await storage.createPresignedUrl("presigned/note.txt", {
        action: "read",
        expiresIn: 300,
      });
      const getRes = await client.presigned.download(presignedGet.token);
      expect(await getRes.text()).toBe("presigned content");

      // 7. Delete file & check usage/tenant
      const delRes = await storage.delete("backup/world.json");
      expect(delRes.existed).toBe(true);
      expect(await storage.exists("backup/world.json")).toBe(false);

      const usage = await client.getUsage();
      expect(usage.usage.fileCount).toBe(2);

      const tenantInfo = await client.getTenant();
      expect(tenantInfo.tenant.name).toBe("SDK Integration Tenant");

      // 8. API keys management
      const createdKey = await client.apiKeys.create({
        name: "read-only-key",
        scopes: ["storage:read"],
      });
      expect(createdKey.secretKey).toMatch(/^sk_live_/);

      const keys = await client.apiKeys.list();
      expect(keys.some((k) => k.id === createdKey.apiKey.id)).toBe(true);

      await client.apiKeys.revoke(createdKey.apiKey.id);

      // 9. Namespace details & delete
      const nsDetails = await client.namespaces.get("sdk-bucket");
      expect(nsDetails.objectCount).toBe(2);

      await client.namespaces.delete("sdk-bucket");
      const remaining = await client.namespaces.list();
      expect(remaining).toHaveLength(0);
    });
  });
});
