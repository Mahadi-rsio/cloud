import { beforeEach, describe, expect, it } from "vitest";
import { StorageService } from "@/lib/storage/service";
import { resetMemoryStorageBucket } from "@/lib/storage/r2";
import { resetStorageDb } from "@/lib/storage/db";

describe("StorageService", () => {
  let service: StorageService;

  beforeEach(() => {
    resetStorageDb();
    resetMemoryStorageBucket();
    service = new StorageService();
  });

  it("creates and retrieves a tenant", async () => {
    const tenant = await service.createTenant({
      name: "Acme Corp",
      plan: "free",
    });

    expect(tenant.id).toMatch(/^t_/);
    expect(tenant.name).toBe("Acme Corp");
    expect(tenant.status).toBe("trial");
    expect(tenant.trialEndsAt).toBeDefined();

    const fetched = await service.getTenant(tenant.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe("Acme Corp");
  });

  it("creates, lists, and deletes a storage namespace", async () => {
    const tenant = await service.createTenant({ name: "Namespaces Tenant" });

    const ns = await service.createNamespace(tenant.id, "my-assets");
    expect(ns.id).toMatch(/^p_/);
    expect(ns.name).toBe("my-assets");

    const list = await service.listNamespaces(tenant.id);
    expect(list.length).toBe(1);
    expect(list[0]?.name).toBe("my-assets");

    await service.deleteNamespace(tenant.id, "my-assets");
    const listAfter = await service.listNamespaces(tenant.id);
    expect(listAfter.length).toBe(0);
  });

  it("creates and authenticates an API key with scopes", async () => {
    const tenant = await service.createTenant({ name: "Auth Tenant" });
    const ns = await service.createNamespace(tenant.id, "media");

    const { apiKey, secretKey } = await service.createApiKey({
      tenantId: tenant.id,
      projectId: ns.id,
      name: "Server Key",
      environment: "live",
      scopes: ["storage:read", "storage:write"],
    });

    expect(secretKey).toMatch(/^sk_live_/);
    expect(apiKey.prefix).toMatch(/^sk_live_/);

    const authenticated = await service.authenticateApiKey(secretKey, "storage:read");
    expect(authenticated.tenant.id).toBe(tenant.id);
    expect(authenticated.apiKey.id).toBe(apiKey.id);

    // Verify lacking scope throws 403
    await expect(
      service.authenticateApiKey(secretKey, "storage:delete"),
    ).rejects.toThrow("API key lacks required scope 'storage:delete'");

    // Verify revocation
    await service.revokeApiKey(tenant.id, apiKey.id);
    await expect(
      service.authenticateApiKey(secretKey, "storage:read"),
    ).rejects.toThrow("This API key has been revoked");
  });

  it("handles file upload, download, range download, listing, and delete", async () => {
    const tenant = await service.createTenant({ name: "File Ops Tenant" });
    await service.createNamespace(tenant.id, "bucket1");

    // 1. Upload file
    const content = "Hello Cloudflare Storage!";
    const uploaded = await service.uploadFile(
      tenant,
      "bucket1",
      "docs/readme.txt",
      content,
      {
        httpMetadata: { contentType: "text/plain" },
      },
    );

    expect(uploaded.path).toBe("docs/readme.txt");
    expect(uploaded.size).toBe(content.length);
    expect(uploaded.etag).toBeDefined();

    // 2. Download file
    const downloaded = await service.downloadFile(tenant, "bucket1", "docs/readme.txt");
    const downloadedText = await downloaded.object.text();
    expect(downloadedText).toBe(content);
    expect(downloaded.object.httpMetadata?.contentType).toBe("text/plain");

    // 3. Range download
    const rangeDownload = await service.downloadFile(tenant, "bucket1", "docs/readme.txt", {
      range: { offset: 6, length: 10 },
    });
    const rangeText = await rangeDownload.object.text();
    expect(rangeText).toBe("Cloudflare");

    // 4. List files
    const listed = await service.listFiles(tenant, "bucket1", { prefix: "docs/" });
    expect(listed.objects.length).toBe(1);
    expect(listed.objects[0]?.path).toBe("docs/readme.txt");

    // 5. Delete file
    await service.deleteFile(tenant, "bucket1", "docs/readme.txt");
    const listAfterDelete = await service.listFiles(tenant, "bucket1");
    expect(listAfterDelete.objects.length).toBe(0);

    // 6. Download after delete throws NOT_FOUND
    await expect(
      service.downloadFile(tenant, "bucket1", "docs/readme.txt"),
    ).rejects.toThrow("File 'docs/readme.txt' not found");
  });

  it("rejects path traversal attempts", async () => {
    const tenant = await service.createTenant({ name: "Security Tenant" });
    await service.createNamespace(tenant.id, "secure-ns");

    await expect(
      service.uploadFile(tenant, "secure-ns", "../evil.sh", "malicious"),
    ).rejects.toThrow("Path traversal ('..') is strictly prohibited.");

    await expect(
      service.uploadFile(tenant, "secure-ns", "/absolute/path.txt", "malicious"),
    ).rejects.toThrow("Path cannot start with a leading slash.");

    await expect(
      service.uploadFile(tenant, "secure-ns", "foo/%2e%2e/bar.txt", "malicious"),
    ).rejects.toThrow("Path contains illegal encoded sequences.");
  });

  it("enforces tenant suspension and blocks upload/download", async () => {
    const tenant = await service.createTenant({ name: "Lifecycle Tenant" });
    await service.createNamespace(tenant.id, "data");

    // Suspend tenant
    const suspended = await service.updateTenant(tenant.id, { status: "suspended" });
    expect(suspended.status).toBe("suspended");

    await expect(
      service.uploadFile(suspended, "data", "test.txt", "hello"),
    ).rejects.toThrow("Tenant account is suspended");

    await expect(
      service.downloadFile(suspended, "data", "test.txt"),
    ).rejects.toThrow("Tenant account is suspended");
  });
});
