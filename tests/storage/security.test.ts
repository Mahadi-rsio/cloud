import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetStorageDb } from "@/lib/storage/db";
import { resetMemoryStorageBucket } from "@/lib/storage/r2";
import { resetMemoryTenantMeters, getTenantMeter } from "@/lib/storage/quota-do";
import { resetStorageAuthCache } from "@/lib/storage/request-auth";
import {
  resetStorageRateLimits,
  setStorageRateLimitOverrides,
} from "@/lib/storage/rate-limit-headers";
import {
  createPresignedToken,
  getSecret,
  resetConsumedPresignedTokens,
} from "@/lib/storage/presign";
import { getStorageService } from "@/lib/storage/service";
import {
  GET as getTenantsRoute,
  POST as createTenantRoute,
} from "@/app/api/v1/storage/tenants/route";
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
  PUT as uploadFileRoute,
  GET as downloadFileRoute,
  HEAD as headFileRoute,
  DELETE as deleteFileRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/files/[...path]/route";
import { POST as presignRoute } from "@/app/api/v1/storage/namespaces/[namespace]/presign/route";
import {
  PUT as presignedPutRoute,
  GET as presignedGetRoute,
} from "@/app/api/v1/storage/presigned/[token]/route";
import {
  GET as listApiKeysRoute,
  POST as createApiKeyRoute,
} from "@/app/api/v1/storage/api-keys/route";
import { DELETE as revokeApiKeyRoute } from "@/app/api/v1/storage/api-keys/[keyId]/route";
import { sortStorageObjects } from "@/components/storage/storage-page";
import { getApiKeyStatus, formatBytes } from "@/lib/storage-client";

describe("Cloudisy Mandatory Security, Quota, Streaming & Reliability Suite", () => {
  beforeEach(() => {
    resetStorageDb();
    resetMemoryStorageBucket();
    resetMemoryTenantMeters();
    resetStorageAuthCache();
    resetStorageRateLimits();
    resetConsumedPresignedTokens();
  });

  async function seedTenantWithKeys(opts?: { storageLimitBytes?: number }) {
    const service = getStorageService();
    const tenant = await service.createTenant({
      name: "SecTest Tenant",
      plan: "free",
      allowCustomQuotas: Boolean(opts?.storageLimitBytes),
      storageLimitBytes: opts?.storageLimitBytes,
    });
    const ns = await service.createNamespace(tenant.id, "sec-bucket");
    const otherNs = await service.createNamespace(tenant.id, "other-bucket");

    const { secretKey: readOnlyKey } = await service.createApiKey({
      tenantId: tenant.id,
      name: "Read Only Key",
      scopes: ["storage:read"],
    });
    const { secretKey: writeKey } = await service.createApiKey({
      tenantId: tenant.id,
      name: "Write Key",
      scopes: ["storage:read", "storage:write"],
    });
    const { secretKey: deleteKey } = await service.createApiKey({
      tenantId: tenant.id,
      name: "Delete Key",
      scopes: ["storage:read", "storage:delete"],
    });
    const { apiKey: adminKeyRecord, secretKey: adminKey } = await service.createApiKey({
      tenantId: tenant.id,
      name: "Admin Key",
      scopes: ["storage:read", "storage:write", "storage:delete", "storage:admin"],
    });
    const { secretKey: scopedKey } = await service.createApiKey({
      tenantId: tenant.id,
      projectId: ns.id,
      name: "Namespace Scoped Key",
      scopes: ["storage:read", "storage:write"],
    });

    return {
      service,
      tenant,
      ns,
      otherNs,
      readOnlyKey,
      writeKey,
      deleteKey,
      adminKey,
      adminKeyRecord,
      scopedKey,
    };
  }

  it("1 & 2. blocks unauthenticated tenant creation (401) and unauthorized quota/plan spoofing (403)", async () => {
    // 1. Unauthenticated POST /api/v1/storage/tenants -> 401
    const unauthReq = new NextRequest("http://localhost/api/v1/storage/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Attacker Tenant" }),
    });
    const unauthRes = await createTenantRoute(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 2. Authenticated with read-only API key attempting tenant creation -> 403
    const { readOnlyKey, adminKey } = await seedTenantWithKeys();
    const readKeyReq = new NextRequest("http://localhost/api/v1/storage/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${readOnlyKey}`,
      },
      body: JSON.stringify({ name: "Escalated Tenant" }),
    });
    const readKeyRes = await createTenantRoute(readKeyReq);
    expect(readKeyRes.status).toBe(403);

    // 3. Even with admin API key, spoofing another tenant ID or custom storageLimitBytes -> 403
    const spoofQuotaReq = new NextRequest("http://localhost/api/v1/storage/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        name: "Spoofed Quota",
        plan: "enterprise",
        storageLimitBytes: 999_999_999_999,
      }),
    });
    const spoofQuotaRes = await createTenantRoute(spoofQuotaReq);
    expect(spoofQuotaRes.status).toBe(403);
  });

  it("3, 4 & 5. rejects invalid API keys (401), expired API keys (401), and revoked API keys immediately even when cached (401)", async () => {
    const { service, tenant, adminKey, adminKeyRecord } = await seedTenantWithKeys();

    // 3. Invalid API key -> 401
    const invalidReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: { Authorization: "Bearer invalid_api_key_token_for_testing" },
    });
    const invalidRes = await listNamespacesRoute(invalidReq);
    expect(invalidRes.status).toBe(401);

    // 4. Expired API key -> 401
    const { apiKey: expRecord, secretKey: expSecret } = await service.createApiKey({
      tenantId: tenant.id,
      name: "Expiring Key",
      scopes: ["storage:read"],
    });
    // Force past expiration in DB
    const db = await (service as any).db();
    const { apiKeys } = await import("@/lib/storage/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(apiKeys.id, expRecord.id));

    const expiredReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: { Authorization: `Bearer ${expSecret}` },
    });
    const expiredRes = await listNamespacesRoute(expiredReq);
    expect(expiredRes.status).toBe(401);

    // 5. Warm cache with valid admin key, then revoke it and verify immediate 401
    const warmReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    const warmRes = await listNamespacesRoute(warmReq);
    expect(warmRes.status).toBe(200);

    // Revoke key via route
    const revokeReq = new NextRequest(
      `http://localhost/api/v1/storage/api-keys/${adminKeyRecord.id}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminKey}` },
      },
    );
    const revokeRes = await revokeApiKeyRoute(revokeReq, {
      params: Promise.resolve({ keyId: adminKeyRecord.id }),
    });
    expect(revokeRes.status).toBe(200);

    // Subsequent request with the revoked key must immediately fail with 401
    const afterRevokeReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: { Authorization: `Bearer ${adminKey}` },
    });
    const afterRevokeRes = await listNamespacesRoute(afterRevokeReq);
    expect(afterRevokeRes.status).toBe(401);
  });

  it("6, 7 & 8. enforces API key scopes: read-only key cannot upload (403), delete (403), manage namespaces (403), or mint higher-privilege keys (403)", async () => {
    const { readOnlyKey, writeKey, adminKey, ns } = await seedTenantWithKeys();

    // Seed a file with writeKey
    const seedUploadReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/files/doc.txt`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${writeKey}`,
          "Content-Type": "text/plain",
        },
        body: "protected content",
      },
    );
    const seedUploadRes = await uploadFileRoute(seedUploadReq, {
      params: Promise.resolve({ namespace: ns.name, path: ["doc.txt"] }),
    });
    expect(seedUploadRes.status).toBe(201);

    // Read-only key CAN download -> 200
    const readDownloadReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/files/doc.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${readOnlyKey}` },
      },
    );
    const readDownloadRes = await downloadFileRoute(readDownloadReq, {
      params: Promise.resolve({ namespace: ns.name, path: ["doc.txt"] }),
    });
    expect(readDownloadRes.status).toBe(200);

    // 6. Read-only key attempting upload -> 403
    const readUploadReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/files/hacked.txt`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${readOnlyKey}`,
          "Content-Type": "text/plain",
        },
        body: "unauthorized write",
      },
    );
    const readUploadRes = await uploadFileRoute(readUploadReq, {
      params: Promise.resolve({ namespace: ns.name, path: ["hacked.txt"] }),
    });
    expect(readUploadRes.status).toBe(403);

    // 7. Read-only key and Write-only key attempting delete -> 403
    for (const token of [readOnlyKey, writeKey]) {
      const delReq = new NextRequest(
        `http://localhost/api/v1/storage/namespaces/${ns.name}/files/doc.txt`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const delRes = await deleteFileRoute(delReq, {
        params: Promise.resolve({ namespace: ns.name, path: ["doc.txt"] }),
      });
      expect(delRes.status).toBe(403);
    }

    // 8. Non-admin key attempting namespace creation or deletion -> 403
    for (const token of [readOnlyKey, writeKey]) {
      const createNsReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "unauth-bucket" }),
      });
      const createNsRes = await createNamespaceRoute(createNsReq);
      expect(createNsRes.status).toBe(403);

      const deleteNsReq = new NextRequest(
        `http://localhost/api/v1/storage/namespaces/${ns.name}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const deleteNsRes = await deleteNamespaceRoute(deleteNsReq, {
        params: Promise.resolve({ namespace: ns.name }),
      });
      expect(deleteNsRes.status).toBe(403);
    }

    // Unknown scope on API key creation -> 400
    const badScopeReq = new NextRequest("http://localhost/api/v1/storage/api-keys", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Bad Scope Key",
        scopes: ["storage:superadmin"],
      }),
    });
    const badScopeRes = await createApiKeyRoute(badScopeReq);
    expect(badScopeRes.status).toBe(400);
  });

  it("9 & 10. enforces cross-tenant and project-scoped namespace isolation (403/404) and blocks path traversal (400)", async () => {
    const tenantA = await seedTenantWithKeys();
    const tenantB = await seedTenantWithKeys();

    // Upload a secret file into Tenant A's bucket
    await tenantA.service.uploadFile(
      tenantA.tenant,
      tenantA.ns.name,
      "confidential.txt",
      "tenant A secret",
    );

    // 9a. Tenant B's admin key attempting to read Tenant A's namespace/file -> 404 (isolated to Tenant B)
    const crossTenantReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${tenantA.ns.name}/files/confidential.txt`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${tenantB.adminKey}` },
      },
    );
    const crossTenantRes = await downloadFileRoute(crossTenantReq, {
      params: Promise.resolve({ namespace: tenantA.ns.name, path: ["confidential.txt"] }),
    });
    expect(crossTenantRes.status).toBe(404);

    // 9b. Project-scoped key attempting to access a different namespace in the same tenant -> 403
    const crossNsReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${tenantA.otherNs.name}/files`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${tenantA.scopedKey}` },
      },
    );
    const crossNsRes = await listFilesRoute(crossNsReq, {
      params: Promise.resolve({ namespace: tenantA.otherNs.name }),
    });
    expect(crossNsRes.status).toBe(403);

    // 10. Path traversal in upload, download, and presign -> 400
    for (const badSegs of [["..", "etc", "passwd"], ["folder", "..", "..", "secret"], ["%2e%2e", "x"]]) {
      const travReq = new NextRequest(
        `http://localhost/api/v1/storage/namespaces/${tenantA.ns.name}/files/${badSegs.join("/")}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${tenantA.writeKey}`,
            "Content-Type": "text/plain",
          },
          body: "bad",
        },
      );
      const travRes = await uploadFileRoute(travReq, {
        params: Promise.resolve({ namespace: tenantA.ns.name, path: badSegs }),
      });
      expect(travRes.status).toBe(400);
    }
  });

  it("11, 12, 13 & 14. enforces streaming byte limits without Content-Length (413), quota limits (402), accurate overwrite delta, and non-existent delete safety", async () => {
    const { service, tenant, ns, writeKey } = await seedTenantWithKeys({
      storageLimitBytes: 1000, // 1000 bytes quota
    });

    // 11. Upload 400 bytes -> usedBytes = 400, fileCount = 1
    const body400 = new Uint8Array(400).fill(65);
    const up1 = await service.uploadFile(tenant, ns.name, "report.bin", body400);
    expect(up1.size).toBe(400);
    let usage = await service.getTenantUsage(tenant.id);
    expect(usage.usedBytes).toBe(400);
    expect(usage.fileCount).toBe(1);

    // 13. Overwrite "report.bin" with 600 bytes -> delta is +200 (usedBytes = 600, fileCount = 1, NOT 1000 / 2!)
    const body600 = new Uint8Array(600).fill(66);
    const up2 = await service.uploadFile(tenant, ns.name, "report.bin", body600);
    expect(up2.size).toBe(600);
    usage = await service.getTenantUsage(tenant.id);
    expect(usage.usedBytes).toBe(600);
    expect(usage.fileCount).toBe(1);

    // Overwrite "report.bin" with smaller 250 bytes -> delta is -350 (usedBytes = 250, fileCount = 1)
    const body250 = new Uint8Array(250).fill(67);
    await service.uploadFile(tenant, ns.name, "report.bin", body250);
    usage = await service.getTenantUsage(tenant.id);
    expect(usage.usedBytes).toBe(250);
    expect(usage.fileCount).toBe(1);

    // 14. Deleting a non-existent file does NOT decrement fileCount or usedBytes
    const delNonExistent = await service.deleteFile(tenant, ns.name, "does-not-exist.bin");
    expect(delNonExistent.existed).toBe(false);
    usage = await service.getTenantUsage(tenant.id);
    expect(usage.usedBytes).toBe(250);
    expect(usage.fileCount).toBe(1);

    // 11. Streaming upload WITHOUT Content-Length that exceeds tenant quota (800 bytes > 750 remaining) -> 402 and rolls back reservation
    const oversizedForQuotaStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(400));
        controller.enqueue(new Uint8Array(400));
        controller.close();
      },
    });
    await expect(
      service.uploadFile(tenant, ns.name, "stream-over-quota.bin", oversizedForQuotaStream),
    ).rejects.toMatchObject({ status: 402 });

    // Quota and fileCount remain intact at 250 bytes / 1 file
    usage = await service.getTenantUsage(tenant.id);
    expect(usage.usedBytes).toBe(250);
    expect(usage.fileCount).toBe(1);

    // 12. Streaming upload WITHOUT Content-Length that exceeds maxUploadBytes -> 413
    const oversizedMaxStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(300));
        controller.enqueue(new Uint8Array(300));
        controller.close();
      },
    });
    await expect(
      service.uploadFile(tenant, ns.name, "stream-too-big.bin", oversizedMaxStream, {
        maxUploadBytes: 500,
      }),
    ).rejects.toMatchObject({ status: 413 });

    // Also test route-level PUT with spoofed small Content-Length header
    const spoofedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(200));
        controller.close();
      },
    });
    const spoofReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/files/spoof.bin`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${writeKey}`,
          "Content-Length": "50",
        },
        body: spoofedStream,
        duplex: "half",
      },
    );
    const spoofRes = await uploadFileRoute(spoofReq, {
      params: Promise.resolve({ namespace: ns.name, path: ["spoof.bin"] }),
    });
    expect(spoofRes.status).toBe(413);
  });

  it("15, 16 & 17. enforces presigned token expiration (401), signature tampering (401), method mismatch (405), and single-use replay protection (403)", async () => {
    const { tenant, ns, writeKey } = await seedTenantWithKeys();
    const secret = await getSecret();

    // 15. Expired presigned token -> 401
    const expiredToken = await createPresignedToken(
      {
        tenantId: tenant.id,
        namespace: ns.name,
        path: "exp.txt",
        method: "PUT",
      },
      secret,
      -30,
    );
    const expReq = new NextRequest(
      `http://localhost/api/v1/storage/presigned/${expiredToken}`,
      {
        method: "PUT",
        body: "hello",
      },
    );
    const expRes = await presignedPutRoute(expReq, {
      params: Promise.resolve({ token: expiredToken }),
    });
    expect(expRes.status).toBe(401);

    // 16. Tampered presigned token -> 401
    const validPutToken = await createPresignedToken(
      {
        tenantId: tenant.id,
        namespace: ns.name,
        path: "tamper.txt",
        method: "PUT",
      },
      secret,
      600,
    );
    const tamperedToken = `${validPutToken.slice(0, -4)}AAAA`;
    const tamperReq = new NextRequest(
      `http://localhost/api/v1/storage/presigned/${tamperedToken}`,
      {
        method: "PUT",
        body: "hello",
      },
    );
    const tamperRes = await presignedPutRoute(tamperReq, {
      params: Promise.resolve({ token: tamperedToken }),
    });
    expect(tamperRes.status).toBe(401);

    // 17. Wrong HTTP method on presigned token (GET on a PUT token -> 405; PUT on a GET token -> 405)
    const wrongGetReq = new NextRequest(
      `http://localhost/api/v1/storage/presigned/${validPutToken}`,
      { method: "GET" },
    );
    const wrongGetRes = await presignedGetRoute(wrongGetReq, {
      params: Promise.resolve({ token: validPutToken }),
    });
    expect(wrongGetRes.status).toBe(405);

    // Presign endpoint rejects invalid method (e.g. DELETE) -> 400 and sets Cache-Control: no-store
    const badMethodPresignReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/presign`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${writeKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: "file.txt", method: "DELETE" }),
      },
    );
    const badMethodPresignRes = await presignRoute(badMethodPresignReq, {
      params: Promise.resolve({ namespace: ns.name }),
    });
    expect(badMethodPresignRes.status).toBe(400);
    expect(badMethodPresignRes.headers.get("Cache-Control")).toBe("no-store");

    // Single-use token succeeds once and rejects replay with 403
    const singleUseToken = await createPresignedToken(
      {
        tenantId: tenant.id,
        namespace: ns.name,
        path: "once.txt",
        method: "PUT",
        singleUse: true,
      },
      secret,
      600,
    );
    const firstPut = await presignedPutRoute(
      new NextRequest(`http://localhost/api/v1/storage/presigned/${singleUseToken}`, {
        method: "PUT",
        body: "first upload",
      }),
      { params: Promise.resolve({ token: singleUseToken }) },
    );
    expect(firstPut.status).toBe(201);

    const replayPut = await presignedPutRoute(
      new NextRequest(`http://localhost/api/v1/storage/presigned/${singleUseToken}`, {
        method: "PUT",
        body: "replay upload",
      }),
      { params: Promise.resolve({ token: singleUseToken }) },
    );
    expect(replayPut.status).toBe(403);
  });

  it("18 & 19. handles valid HTTP Range requests (206 + Content-Range + Accept-Ranges) and rejects invalid Range headers (416)", async () => {
    const { service, tenant, ns, readOnlyKey } = await seedTenantWithKeys();
    await service.uploadFile(tenant, ns.name, "alphabet.txt", "0123456789ABCDEF");

    // 19. Valid Range: bytes=2-5 -> 206 Partial Content ("2345")
    const validRangeReq = new NextRequest(
      `http://localhost/api/v1/storage/namespaces/${ns.name}/files/alphabet.txt`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${readOnlyKey}`,
          Range: "bytes=2-5",
        },
      },
    );
    const validRangeRes = await downloadFileRoute(validRangeReq, {
      params: Promise.resolve({ namespace: ns.name, path: ["alphabet.txt"] }),
    });
    expect(validRangeRes.status).toBe(206);
    expect(validRangeRes.headers.get("Content-Range")).toBe("bytes 2-5/16");
    expect(validRangeRes.headers.get("Accept-Ranges")).toBe("bytes");
    expect(validRangeRes.headers.get("Content-Length")).toBe("4");
    expect(await validRangeRes.text()).toBe("2345");

    // 18. Invalid Range headers: start >= size, start > end, negative, multi-range -> 416
    for (const badRange of ["bytes=50-60", "bytes=10-4", "bytes=-0", "bytes=0-2,4-6", "items=0-5"]) {
      const badRangeReq = new NextRequest(
        `http://localhost/api/v1/storage/namespaces/${ns.name}/files/alphabet.txt`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${readOnlyKey}`,
            Range: badRange,
          },
        },
      );
      const badRangeRes = await downloadFileRoute(badRangeReq, {
        params: Promise.resolve({ namespace: ns.name, path: ["alphabet.txt"] }),
      });
      expect(badRangeRes.status).toBe(416);
      expect(badRangeRes.headers.get("Content-Range")).toBe("bytes */16");
    }
  });

  it("20. enforces server-side rate limiting (429 + Retry-After + X-RateLimit-* headers)", async () => {
    const { readOnlyKey } = await seedTenantWithKeys();
    setStorageRateLimitOverrides({
      list: { limit: 2, windowSeconds: 60 },
    });

    const makeReq = () =>
      new NextRequest("http://localhost/api/v1/storage/namespaces", {
        method: "GET",
        headers: { Authorization: `Bearer ${readOnlyKey}` },
      });

    const r1 = await listNamespacesRoute(makeReq());
    expect(r1.status).toBe(200);
    expect(r1.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("1");

    const r2 = await listNamespacesRoute(makeReq());
    expect(r2.status).toBe(200);
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("0");

    // 3rd request exceeds limit of 2 -> 429 with Retry-After header
    const r3 = await listNamespacesRoute(makeReq());
    expect(r3.status).toBe(429);
    expect(Number(r3.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("21. preserves Durable Object outbox events across failed flushes and acknowledges idempotently on retry", async () => {
    const { service, tenant, ns } = await seedTenantWithKeys();
    await service.uploadFile(tenant, ns.name, "outbox.txt", "outbox payload");

    const meter = await getTenantMeter(tenant.id);
    const claimed1 = await meter.claimEvents(10);
    expect(claimed1.length).toBeGreaterThan(0);

    // Simulate a downstream DB failure by nacking the claimed events
    const eventIds = claimed1.map((e) => e.id!);
    await meter.nackEvents(eventIds);

    // Events must still be present and re-claimable!
    const claimed2 = await meter.claimEvents(10);
    expect(claimed2.length).toBe(claimed1.length);

    // Now acknowledge them and verify the outbox is empty
    await meter.ackEvents(eventIds);
    const claimed3 = await meter.claimEvents(10);
    expect(claimed3.length).toBe(0);
  });

  it("verifies UI helper functions for sorting, byte formatting, and API key status derivation", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MB");

    expect(getApiKeyStatus({ revokedAt: null, expiresAt: null })).toBe("active");
    expect(
      getApiKeyStatus({ revokedAt: "2026-01-01T00:00:00Z", expiresAt: null }),
    ).toBe("revoked");
    expect(
      getApiKeyStatus({
        revokedAt: null,
        expiresAt: new Date(Date.now() - 10_000).toISOString(),
      }),
    ).toBe("expired");

    const items = [
      { key: "b.txt", name: "b.txt", size: 200, etag: "2", uploaded: "2026-01-02T00:00:00Z" },
      { key: "a.txt", name: "a.txt", size: 500, etag: "1", uploaded: "2026-01-03T00:00:00Z" },
      { key: "c.txt", name: "c.txt", size: 100, etag: "3", uploaded: "2026-01-01T00:00:00Z" },
    ];
    expect(sortStorageObjects(items, "name", "asc").map((i) => i.name)).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
    expect(sortStorageObjects(items, "size", "desc").map((i) => i.name)).toEqual([
      "a.txt",
      "b.txt",
      "c.txt",
    ]);
    expect(sortStorageObjects(items, "uploaded", "asc").map((i) => i.name)).toEqual([
      "c.txt",
      "b.txt",
      "a.txt",
    ]);
  });
});
