import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validatePath, formatObjectKey } from "@/lib/storage/keys";
import { MemoryStorageBucket } from "@/lib/storage/r2";
import { StorageService } from "@/lib/storage/service";
import { createPresignedToken, verifyPresignedToken } from "@/lib/storage/presign";
import type { Tenant } from "@/lib/storage/schema";

describe("Storage Phase 2 Data Plane", () => {
  const mockTenant: Tenant = {
    id: "t_testtenant1234567890",
    name: "Test Tenant",
    plan: "free",
    status: "active",
    storageUsed: 0,
    storageLimit: 5368709120,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("validates and normalizes paths, preventing path traversal", () => {
    assert.equal(validatePath("documents/report.pdf").valid, true);
    assert.equal(validatePath("folder/subfolder/file.txt").valid, true);

    // Traversal attempts
    assert.equal(validatePath("../secret.txt").valid, false);
    assert.equal(validatePath("folder/../../secret.txt").valid, false);
    assert.equal(validatePath("/leading-slash.txt").valid, false);
    assert.equal(validatePath("folder//empty-segment.txt").valid, false);
    assert.equal(validatePath("folder/./current.txt").valid, false);
    assert.equal(validatePath("folder/%2e%2e/encoded.txt").valid, false);
  });

  it("formats object keys using deterministic multi-tenant layout", () => {
    const key = formatObjectKey("t_tenant123", "my-bucket", "docs/file.txt");
    assert.equal(key, "t_tenant123/my-bucket/docs/file.txt");
  });

  it("generates and verifies HMAC-SHA256 presigned tokens", async () => {
    const secret = "super-secret-test-key-at-least-32-chars-long";
    const payload = {
      tenantId: "t_tenant123",
      namespace: "uploads",
      path: "photo.jpg",
      method: "PUT" as const,
    };

    const token = await createPresignedToken(payload, secret, 300);
    assert.ok(token);
    assert.equal(token.split(".").length, 3);

    const verified = await verifyPresignedToken(token, secret);
    assert.equal(verified.tenantId, payload.tenantId);
    assert.equal(verified.namespace, payload.namespace);
    assert.equal(verified.path, payload.path);
    assert.equal(verified.method, "PUT");
    assert.ok(verified.expiresAt > Date.now());

    // Expired or bad signature tokens fail
    await assert.rejects(
      async () => verifyPresignedToken(token, "wrong-secret-key-1234567890"),
      /Presigned token signature is invalid/
    );

    const expiredToken = await createPresignedToken(payload, secret, -10);
    await assert.rejects(
      async () => verifyPresignedToken(expiredToken, secret),
      /Presigned token has expired/
    );
  });

  it("performs file upload, download, head, and copy using MemoryStorageBucket", async () => {
    const memoryBucket = new MemoryStorageBucket();
    let lastQueriedNs = "source-ns";
    const service = new StorageService(
      Promise.resolve({
        select: () => ({
          from: (table: any) => ({
            where: (cond: any) => {
              // Return matching namespace based on query context
              const currentNs = lastQueriedNs;
              return Promise.resolve([
                { id: `p_${currentNs}`, tenantId: mockTenant.id, name: currentNs },
              ]);
            },
          }),
        }),
        insert: () => ({ values: () => Promise.resolve() }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        delete: () => ({ where: () => Promise.resolve() }),
      } as any),
      Promise.resolve(memoryBucket)
    );

    // Mock getNamespace directly on service for deterministic namespace resolution
    service.getNamespace = async (_tId: string, nameOrId: string) => {
      return {
        id: `p_${nameOrId}`,
        tenantId: mockTenant.id,
        name: nameOrId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    };

    // 1. Upload
    const content = "Hello Phase 2 Object Storage!";
    const uploaded = await service.uploadFile(mockTenant, "source-ns", "hello.txt", content, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { "idempotency-key": "req-123" },
    });

    assert.equal(uploaded.namespace, "source-ns");
    assert.equal(uploaded.path, "hello.txt");
    assert.ok(uploaded.etag);
    assert.equal(uploaded.size, Buffer.byteLength(content));

    // 2. Head
    const head = await service.headFile(mockTenant, "source-ns", "hello.txt");
    assert.equal(head.size, uploaded.size);
    assert.equal(head.etag, uploaded.etag);

    // 3. Download
    const downloaded = await service.downloadFile(mockTenant, "source-ns", "hello.txt");
    const text = await downloaded.object.text();
    assert.equal(text, content);

    // 4. Copy to destination namespace
    const copied = await service.copyFile(
      mockTenant,
      "source-ns",
      "hello.txt",
      "dest-ns",
      "copied/hello-copy.txt"
    );

    assert.equal(copied.sourceNamespace, "source-ns");
    assert.equal(copied.sourcePath, "hello.txt");
    assert.equal(copied.destinationNamespace, "dest-ns");
    assert.equal(copied.destinationPath, "copied/hello-copy.txt");
    assert.equal(copied.size, uploaded.size);

    // Verify copied file exists at destination
    const destDownloaded = await service.downloadFile(mockTenant, "dest-ns", "copied/hello-copy.txt");
    assert.equal(await destDownloaded.object.text(), content);
  });
});
