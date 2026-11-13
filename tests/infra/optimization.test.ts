import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypedKvCache, resetAppKv } from "@/lib/kv";
import { assertRateLimit, resetRateLimits } from "@/lib/rate-limit";
import {
  checkStorageRateLimit,
  resetStorageRateLimits,
  setStorageRateLimitOverrides,
} from "@/lib/storage/rate-limit-headers";
import { getStorageDb, resetStorageDb } from "@/lib/storage/db";
import { resetMemoryStorageBucket } from "@/lib/storage/r2";
import { resetMemoryTenantMeters, getTenantMeter } from "@/lib/storage/quota-do";
import { getStorageService } from "@/lib/storage/service";
import {
  authenticateStorageRequest,
  invalidateApiKeyCache,
  resetStorageAuthCache,
} from "@/lib/storage/request-auth";
import { DeploymentStreamDO } from "@/lib/build/deployment-stream-do";
import { usageDaily, usageEvents } from "@/lib/storage/schema";

describe("Production Infrastructure Optimization & Reliability", () => {
  beforeEach(() => {
    resetAppKv();
    resetRateLimits();
    resetStorageRateLimits();
    resetStorageDb();
    resetMemoryStorageBucket();
    resetMemoryTenantMeters();
    resetStorageAuthCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. TypedKvCache (L1 + KV abstraction)", () => {
    it("coalesces concurrent cache misses (stampede protection) and supports invalidation", async () => {
      const kv = new TypedKvCache("test:ns", "v1");
      let loaderCalls = 0;

      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          kv.getOrLoad(
            "item-1",
            async () => {
              loaderCalls += 1;
              await new Promise((r) => setTimeout(r, 10));
              return { id: "item-1", name: "alpha" };
            },
            { kvTtlSeconds: 10, l1TtlMs: 5_000 },
          ),
        ),
      );

      expect(loaderCalls).toBe(1);
      expect(results.every((r) => r?.name === "alpha")).toBe(true);

      await kv.delete("item-1");
      const afterDelete = await kv.getJson("item-1");
      expect(afterDelete).toBeNull();
    });
  });

  describe("2. Rate Limiting (API, Studio, Storage Free vs Pro)", () => {
    it("enforces category limits and preserves 429 + Retry-After + X-RateLimit-* headers", async () => {
      await assertRateLimit("studio:u1", { limit: 2, windowSeconds: 60, category: "studio" });
      await assertRateLimit("studio:u1", { limit: 2, windowSeconds: 60, category: "studio" });
      await expect(
        assertRateLimit("studio:u1", { limit: 2, windowSeconds: 60, category: "studio" }),
      ).rejects.toMatchObject({ status: 429 });

      setStorageRateLimitOverrides({
        read: { limit: 2, windowSeconds: 60 },
      });
      const h1 = new Headers();
      await checkStorageRateLimit("t_1", "read", h1, "free");
      expect(h1.get("X-RateLimit-Limit")).toBe("2");
      expect(h1.get("X-RateLimit-Remaining")).toBe("1");

      const h2 = new Headers();
      await checkStorageRateLimit("t_1", "read", h2, "free");
      expect(h2.get("X-RateLimit-Remaining")).toBe("0");

      const h3 = new Headers();
      await expect(checkStorageRateLimit("t_1", "read", h3, "free")).rejects.toMatchObject({
        status: 429,
      });
      expect(h3.get("Retry-After")).toBeTruthy();
    });
  });

  describe("3. Storage API Auth Cache & Revocation Security", () => {
    it("serves repeated API key auth requests with 0 Neon queries on cache hit and blocks immediately on revocation", async () => {
      const service = getStorageService();
      const tenant = await service.createTenant({ name: "Acme", plan: "pro" });
      const ns = await service.createNamespace(tenant.id, "assets");
      const { apiKey, secretKey } = await service.createApiKey({
        tenantId: tenant.id,
        projectId: ns.id,
        name: "ci-key",
        scopes: ["storage:read", "storage:write"],
      });

      const db = await getStorageDb();
      let selectCalls = 0;
      let updateCalls = 0;
      const origSelect = db.select.bind(db);
      const origUpdate = db.update.bind(db);
      vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
        selectCalls += 1;
        return (origSelect as (...a: any[]) => any)(...args);
      });
      vi.spyOn(db, "update").mockImplementation((...args: any[]) => {
        updateCalls += 1;
        return (origUpdate as (...a: any[]) => any)(...args);
      });

      // Cold miss: queries DB once for apiKey + throttled lastUsedAt update
      const req1 = new Request("https://api.cloudisy.test/v1/storage", {
        headers: { Authorization: `Bearer ${secretKey}` },
      });
      const ctx1 = await authenticateStorageRequest(req1, "storage:read", {
        namespace: "assets",
      });
      expect(ctx1.tenant.id).toBe(tenant.id);
      const coldSelects = selectCalls;
      expect(coldSelects).toBeGreaterThanOrEqual(1);
      expect(updateCalls).toBe(1);

      // 50 subsequent cache hits: 0 DB selects, 0 lastUsedAt updates
      selectCalls = 0;
      updateCalls = 0;
      for (let i = 0; i < 50; i++) {
        const req = new Request("https://api.cloudisy.test/v1/storage", {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        const ctx = await authenticateStorageRequest(req, "storage:read", {
          namespace: "assets",
        });
        expect(ctx.tenant.id).toBe(tenant.id);
      }
      expect(selectCalls).toBe(0);
      expect(updateCalls).toBe(0);

      // Cross-namespace isolation check
      await expect(
        authenticateStorageRequest(req1, "storage:read", { namespace: "other-ns" }),
      ).rejects.toMatchObject({ status: 403 });

      // Revocation immediately blocks cached key
      await service.revokeApiKey(tenant.id, apiKey.id);
      await invalidateApiKeyCache({ keyId: apiKey.id, keyHash: apiKey.keyHash });
      await expect(
        authenticateStorageRequest(req1, "storage:read", { namespace: "assets" }),
      ).rejects.toMatchObject({ status: 401 });
    });
  });

  describe("4. Outbox Usage Metering, Idempotency & R2 Reconciliation", () => {
    it("records 0 synchronous Neon usage queries on upload/download/delete and flushes idempotently", async () => {
      const service = getStorageService();
      const tenant = await service.createTenant({ name: "MeterCo", plan: "free" });
      await service.createNamespace(tenant.id, "media");

      const db = await getStorageDb();
      let dbInsertCalls = 0;
      const origInsert = db.insert.bind(db);
      vi.spyOn(db, "insert").mockImplementation((table: any) => {
        if (table === usageEvents || table === usageDaily) {
          dbInsertCalls += 1;
        }
        return origInsert(table);
      });

      // 20 uploads + 20 downloads + 10 deletes = 50 operations -> 0 sync DB usage inserts
      for (let i = 0; i < 20; i++) {
        await service.uploadFile(tenant, "media", `f-${i}.txt`, `payload-${i}`);
        await service.downloadFile(tenant, "media", `f-${i}.txt`);
      }
      for (let i = 0; i < 10; i++) {
        await service.deleteFile(tenant, "media", `f-${i}.txt`);
      }
      expect(dbInsertCalls).toBe(0);

      // Flush DO outbox to DB in a single batch
      const flushed = await service.flushTenantOutbox(tenant.id, 200);
      expect(flushed.flushed).toBe(50);

      const events = await db.select().from(usageEvents);
      expect(events.length).toBe(50);

      // Replaying the exact same eventId does not double-count usageDaily
      const firstEvt = events[0]!;
      const beforeDaily = await db.select().from(usageDaily);
      const beforeWriteOps = beforeDaily[0]!.writeOps;
      const beforeReadOps = beforeDaily[0]!.readOps;
      await service.recordUsage(
        tenant.id,
        null,
        firstEvt.eventType as any,
        Number(firstEvt.bytes),
        Number(firstEvt.ops),
        firstEvt.classType as any,
        firstEvt.id,
      );
      const afterDaily = await db.select().from(usageDaily);
      expect(afterDaily[0]!.writeOps).toBe(beforeWriteOps);
      expect(afterDaily[0]!.readOps).toBe(beforeReadOps);

      // R2 reconciliation syncs exact bytes & file count
      const reconciled = await service.reconcileTenantUsage(tenant.id);
      expect(reconciled.actualFileCount).toBe(10);
      const meter = await getTenantMeter(tenant.id);
      const snapshot = await meter.getUsage();
      expect(snapshot.fileCount).toBe(10);
      expect(snapshot.usedBytes).toBe(reconciled.actualBytes);
    });
  });

  describe("5. DeploymentStreamDO SSE Push & Recovery Alarm Lifecycle", () => {
    it("pushes live logs to multiple subscribers and closes cleanly on terminal status", async () => {
      let alarmTime: number | null = null;
      const mockCtx = {
        id: { name: "dep-123" },
        storage: {
          setAlarm: async (ts: number) => {
            alarmTime = ts;
          },
          deleteAlarm: async () => {
            alarmTime = null;
          },
        },
      };

      const streamDo = new DeploymentStreamDO(mockCtx, {});
      await streamDo.fetch(
        new Request("https://stream.internal/register-recovery", {
          method: "POST",
          body: JSON.stringify({ deploymentId: "dep-123", staleAfterMs: 60_000 }),
        }),
      );
      expect(alarmTime).not.toBeNull();

      const res1 = await streamDo.fetch(
        new Request("https://stream.internal/subscribe?after=0"),
      );
      const res2 = await streamDo.fetch(
        new Request("https://stream.internal/subscribe?after=0"),
      );

      await streamDo.fetch(
        new Request("https://stream.internal/publish-logs", {
          method: "POST",
          body: JSON.stringify({
            deploymentId: "dep-123",
            rows: [
              {
                id: 1,
                deploymentId: "dep-123",
                stream: "stdout",
                message: "Building image...",
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        }),
      );

      await streamDo.fetch(
        new Request("https://stream.internal/publish-status", {
          method: "POST",
          body: JSON.stringify({
            deploymentId: "dep-123",
            status: "active",
            publicUrl: "https://dep-123.fly.dev",
          }),
        }),
      );

      // Recovery alarm is cancelled on terminal status
      expect(alarmTime).toBeNull();

      const text1 = await res1.text();
      const text2 = await res2.text();
      expect(text1).toContain("Building image...");
      expect(text1).toContain("event: done");
      expect(text2).toContain("Building image...");
      expect(text2).toContain("event: done");
    });
  });

  describe("6. Workload Benchmark (Auth + 100 Storage Operations)", () => {
    it("measures DB queries and p50/p95/p99 latency across 100 authenticated storage ops", async () => {
      const service = getStorageService();
      const tenant = await service.createTenant({ name: "BenchCo", plan: "pro" });
      const ns = await service.createNamespace(tenant.id, "bench");
      const { secretKey } = await service.createApiKey({
        tenantId: tenant.id,
        projectId: ns.id,
        name: "bench-key",
        scopes: ["storage:read", "storage:write"],
      });

      const db = await getStorageDb();
      let totalDbOps = 0;
      const origSelect = db.select.bind(db);
      const origInsert = db.insert.bind(db);
      const origUpdate = db.update.bind(db);
      vi.spyOn(db, "select").mockImplementation((...args: any[]) => {
        totalDbOps += 1;
        return (origSelect as (...a: any[]) => any)(...args);
      });
      vi.spyOn(db, "insert").mockImplementation((...args: any[]) => {
        totalDbOps += 1;
        return (origInsert as (...a: any[]) => any)(...args);
      });
      vi.spyOn(db, "update").mockImplementation((...args: any[]) => {
        totalDbOps += 1;
        return (origUpdate as (...a: any[]) => any)(...args);
      });

      const latenciesMs: number[] = [];
      for (let i = 0; i < 100; i++) {
        const t0 = performance.now();
        const req = new Request("https://api.cloudisy.test/v1/storage", {
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        const ctx = await authenticateStorageRequest(req, "storage:write", {
          namespace: "bench",
        });
        await service.uploadFile(ctx.tenant, "bench", `obj-${i}.txt`, `data-${i}`);
        latenciesMs.push(performance.now() - t0);
      }

      // Flush all 100 usage events in 1 batch
      const flushResult = await service.flushTenantOutbox(tenant.id, 200);
      expect(flushResult.flushed).toBe(100);

      latenciesMs.sort((a, b) => a - b);
      const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)]!;
      const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)]!;
      const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)]!;

      console.info(
        `[BENCHMARK] 100 auth+upload ops: totalDbOps=${totalDbOps} (avg ${(totalDbOps / 100).toFixed(2)}/op), p50=${p50.toFixed(3)}ms, p95=${p95.toFixed(3)}ms, p99=${p99.toFixed(3)}ms`,
      );

      // Before optimization: ~6 DB ops/req (~600 total for 100 ops).
      // After optimization: <= 10 total DB ops for all 100 requests + batch flush!
      expect(totalDbOps).toBeLessThan(20);
    });
  });
});
