import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetStorageDb } from "@/lib/storage/db";
import { resetMemoryStorageBucket } from "@/lib/storage/r2";
import { POST as createTenantRoute } from "@/app/api/v1/storage/tenants/route";
import {
  GET as listNamespacesRoute,
  POST as createNamespaceRoute,
} from "@/app/api/v1/storage/namespaces/route";
import {
  GET as getNamespaceRoute,
  DELETE as deleteNamespaceRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/route";
import {
  GET as listFilesRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/files/route";
import {
  GET as downloadFileRoute,
  PUT as uploadFileRoute,
  HEAD as headFileRoute,
  DELETE as deleteFileRoute,
} from "@/app/api/v1/storage/namespaces/[namespace]/files/[...path]/route";
import {
  GET as listApiKeysRoute,
  POST as createApiKeyRoute,
} from "@/app/api/v1/storage/api-keys/route";
import { DELETE as revokeApiKeyRoute } from "@/app/api/v1/storage/api-keys/[keyId]/route";

describe("Storage API Routes (End-to-End)", () => {
  beforeEach(() => {
    resetStorageDb();
    resetMemoryStorageBucket();
  });

  it("handles full lifecycle: tenant, namespace, API key, upload, download, and delete", async () => {
    // 1. Create Tenant
    const tenantReq = new NextRequest("http://localhost/api/v1/storage/tenants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-internal-admin": "1",
      },
      body: JSON.stringify({ name: "E2E Test Tenant", plan: "free" }),
    });
    const tenantRes = await createTenantRoute(tenantReq);
    expect(tenantRes.status).toBe(201);
    const tenantBody = (await tenantRes.json()) as { data: { tenant: { id: string } } };
    const tenantId = tenantBody.data.tenant.id;
    expect(tenantId).toMatch(/^t_/);

    // 2. Create API Key for this tenant (using direct service or admin key)
    const apiKeyReq = new NextRequest("http://localhost/api/v1/storage/api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Direct tenant creation / key creation can be seeded
      },
    });

    // We can seed the initial master key directly via service
    const { getStorageService } = await import("@/lib/storage/service");
    const service = getStorageService();
    const { apiKey, secretKey } = await service.createApiKey({
      tenantId,
      name: "Master Key",
      scopes: ["storage:read", "storage:write", "storage:delete"],
    });

    const authHeaders = {
      Authorization: `Bearer ${secretKey}`,
    };

    // 3. Create Namespace with API key
    const createNsReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "prod-media" }),
    });
    const createNsRes = await createNamespaceRoute(createNsReq);
    expect(createNsRes.status).toBe(201);
    const nsBody = (await createNsRes.json()) as { data: { name: string } };
    expect(nsBody.data.name).toBe("prod-media");

    // 4. List Namespaces
    const listNsReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: authHeaders,
    });
    const listNsRes = await listNamespacesRoute(listNsReq);
    expect(listNsRes.status).toBe(200);
    const listNsBody = (await listNsRes.json()) as { data: { namespaces: Array<{ name: string }> } };
    expect(listNsBody.data.namespaces.length).toBe(1);
    expect(listNsBody.data.namespaces[0]?.name).toBe("prod-media");

    // 5. Upload a file to this namespace using API key
    const fileContent = "This is a stored production asset.";
    const uploadReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files/documents/spec.pdf",
      {
        method: "PUT",
        headers: {
          ...authHeaders,
          "Content-Type": "application/pdf",
          "x-storage-meta-version": "1.0",
        },
        body: fileContent,
      },
    );
    const uploadRes = await uploadFileRoute(uploadReq, {
      params: Promise.resolve({ namespace: "prod-media", path: ["documents", "spec.pdf"] }),
    });
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as { data: { path: string; size: number } };
    expect(uploadBody.data.path).toBe("documents/spec.pdf");
    expect(uploadBody.data.size).toBe(fileContent.length);

    // 6. Download the file with API key
    const downloadReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files/documents/spec.pdf",
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const downloadRes = await downloadFileRoute(downloadReq, {
      params: Promise.resolve({ namespace: "prod-media", path: ["documents", "spec.pdf"] }),
    });
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(await downloadRes.text()).toBe(fileContent);

    // 7. Check HEAD file
    const headReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files/documents/spec.pdf",
      {
        method: "HEAD",
        headers: authHeaders,
      },
    );
    const headRes = await headFileRoute(headReq, {
      params: Promise.resolve({ namespace: "prod-media", path: ["documents", "spec.pdf"] }),
    });
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(headRes.headers.get("Content-Length")).toBe(fileContent.length.toString());

    // 8. List files in namespace
    const listFilesReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files?prefix=documents/",
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const listFilesRes = await listFilesRoute(listFilesReq, {
      params: Promise.resolve({ namespace: "prod-media" }),
    });
    expect(listFilesRes.status).toBe(200);
    const listFilesBody = (await listFilesRes.json()) as { data: { objects: Array<{ path: string }> } };
    expect(listFilesBody.data.objects.length).toBe(1);
    expect(listFilesBody.data.objects[0]?.path).toBe("documents/spec.pdf");

    // 9. Delete file
    const deleteFileReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files/documents/spec.pdf",
      {
        method: "DELETE",
        headers: authHeaders,
      },
    );
    const deleteFileRes = await deleteFileRoute(deleteFileReq, {
      params: Promise.resolve({ namespace: "prod-media", path: ["documents", "spec.pdf"] }),
    });
    expect(deleteFileRes.status).toBe(200);

    // 10. Verify Download now returns 404
    const downloadAfterDeleteReq = new NextRequest(
      "http://localhost/api/v1/storage/namespaces/prod-media/files/documents/spec.pdf",
      {
        method: "GET",
        headers: authHeaders,
      },
    );
    const downloadAfterDeleteRes = await downloadFileRoute(downloadAfterDeleteReq, {
      params: Promise.resolve({ namespace: "prod-media", path: ["documents", "spec.pdf"] }),
    });
    expect(downloadAfterDeleteRes.status).toBe(404);

    // 11. Revoke API Key
    const revokeReq = new NextRequest(`http://localhost/api/v1/storage/api-keys/${apiKey.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    const revokeRes = await revokeApiKeyRoute(revokeReq, {
      params: Promise.resolve({ keyId: apiKey.id }),
    });
    expect(revokeRes.status).toBe(200);

    // 12. Verify request with revoked key fails with 401
    const unauthorizedReq = new NextRequest("http://localhost/api/v1/storage/namespaces", {
      method: "GET",
      headers: authHeaders,
    });
    const unauthorizedRes = await listNamespacesRoute(unauthorizedReq);
    expect([401, 403]).toContain(unauthorizedRes.status);
  });
});
