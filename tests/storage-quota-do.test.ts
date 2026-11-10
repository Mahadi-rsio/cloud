import test from "node:test";
import assert from "node:assert/strict";
import {
  getTenantMeter,
  MemoryTenantMeter,
  resetMemoryTenantMeters,
  TenantMeterDO,
} from "../lib/storage/quota-do";
import { STORAGE_PLANS } from "../lib/storage/schema";
import { StorageService } from "../lib/storage/service";
import { MemoryStorageBucket } from "../lib/storage/r2";
import type { Tenant } from "../lib/storage/schema";

test("Storage Quota & Metering with Durable Object", async (t) => {
  await t.test("enforces Free Plan default limits (512 MB, 100k read, 100k write)", () => {
    assert.equal(STORAGE_PLANS.free.storageLimitBytes, 512 * 1024 * 1024);
    assert.equal(STORAGE_PLANS.free.monthlyReadLimitOps, 100_000);
    assert.equal(STORAGE_PLANS.free.monthlyWriteLimitOps, 100_000);
  });

  await t.test("MemoryTenantMeter: atomically reserves bytes and blocks over-quota writes", async () => {
    const meter = new MemoryTenantMeter();
    const limit = 1000; // 1000 bytes

    // 1. Reserve 600 bytes -> ok
    const res1 = await meter.reserveBytes(600, limit);
    assert.equal(res1.ok, true);
    assert.equal(res1.usedBytes, 600);
    assert.equal(res1.remainingBytes, 400);

    // 2. Reserve 500 bytes -> exceeds limit (600 + 500 = 1100 > 1000)
    const res2 = await meter.reserveBytes(500, limit);
    assert.equal(res2.ok, false);
    assert.equal(res2.reason, "STORAGE_QUOTA_EXCEEDED");
    assert.equal(res2.usedBytes, 600); // Unchanged!
    assert.equal(res2.remainingBytes, 400);

    // 3. Commit the 600 bytes
    await meter.commitBytes(600);
    const usage = await meter.getUsage();
    assert.equal(usage.usedBytes, 600);
    assert.equal(usage.fileCount, 1);
    assert.equal(usage.monthlyWriteOps, 1);

    // 4. Release / Delete 200 bytes
    await meter.deleteFile(200);
    const updated = await meter.getUsage();
    assert.equal(updated.usedBytes, 400);
    assert.equal(updated.fileCount, 0);
    assert.equal(updated.monthlyWriteOps, 2); // 1 upload + 1 delete = 2 write ops

    // 5. Now 500 bytes can fit (400 + 500 = 900 <= 1000)
    const res3 = await meter.reserveBytes(500, limit);
    assert.equal(res3.ok, true);
    assert.equal(res3.usedBytes, 900);
  });

  await t.test("MemoryTenantMeter: enforces monthly Class A (write) operation caps", async () => {
    const meter = new MemoryTenantMeter();
    const writeLimit = 3;

    // Record 3 write operations
    const op1 = await meter.recordOperation("class_a", "write", 100, writeLimit);
    assert.equal(op1.ok, true);
    assert.equal(op1.count, 1);

    const op2 = await meter.recordOperation("class_a", "write", 100, writeLimit);
    assert.equal(op2.ok, true);
    assert.equal(op2.count, 2);

    const op3 = await meter.recordOperation("class_a", "write", 100, writeLimit);
    assert.equal(op3.ok, true);
    assert.equal(op3.count, 3);

    // 4th operation should be rejected
    const op4 = await meter.recordOperation("class_a", "write", 100, writeLimit);
    assert.equal(op4.ok, false);
    assert.equal(op4.reason, "MONTHLY_WRITE_QUOTA_EXCEEDED");
  });

  await t.test("MemoryTenantMeter: enforces monthly Class B (read) operation caps", async () => {
    const meter = new MemoryTenantMeter();
    const readLimit = 2;

    const op1 = await meter.recordOperation("class_b", "read", 50, readLimit);
    assert.equal(op1.ok, true);
    assert.equal(op1.count, 1);

    const op2 = await meter.recordOperation("class_b", "read", 50, readLimit);
    assert.equal(op2.ok, true);
    assert.equal(op2.count, 2);

    // 3rd read operation should be rejected
    const op3 = await meter.recordOperation("class_b", "read", 50, readLimit);
    assert.equal(op3.ok, false);
    assert.equal(op3.reason, "MONTHLY_READ_QUOTA_EXCEEDED");
  });

  await t.test("reconcile: synchronizes R2 actual bytes with meter", async () => {
    const meter = new MemoryTenantMeter(1000, 5);
    assert.equal((await meter.getUsage()).usedBytes, 1000);

    // Reconcile to truth: 450 bytes across 2 files
    await meter.reconcile(450, 2);
    const usage = await meter.getUsage();
    assert.equal(usage.usedBytes, 450);
    assert.equal(usage.fileCount, 2);
  });

  await t.test("StorageService integration: blocks upload when tenant storage quota is exceeded", async () => {
    resetMemoryTenantMeters();
    const bucket = new MemoryStorageBucket();
    const mockDb = Promise.resolve({
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as any);

    const service = new StorageService(mockDb, Promise.resolve(bucket));
    (service as any).recordUsage = async () => {};
    (service as any).recordAudit = async () => {};

    const mockTenant: Tenant = {
      id: "t_test_quota_tenant",
      name: "Quota Tenant",
      status: "active",
      plan: "free",
      storageLimitBytes: 500, // 500 bytes limit
      storageUsedBytes: 0,
      fileCount: 0,
      monthlyReadLimitOps: 100_000,
      monthlyWriteLimitOps: 100_000,
      bandwidthLimitBytes: 5000,
      egressRateLimitMbps: 100,
      trialEndsAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (service as any).getNamespace = async () => ({
      id: "ns_123",
      tenantId: mockTenant.id,
      name: "media",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // 1. Upload 300 bytes -> ok
    const payload300 = new Uint8Array(300);
    const upload1 = await service.uploadFile(mockTenant, "media", "file1.bin", payload300);
    assert.equal(upload1.size, 300);

    // 2. Upload 300 bytes -> exceeds 500 limit (300 + 300 = 600 > 500) -> throws 402
    await assert.rejects(
      async () => {
        await service.uploadFile(mockTenant, "media", "file2.bin", payload300);
      },
      (err: any) => {
        assert.equal(err.status, 402);
        assert.match(err.message, /Storage quota exceeded/);
        return true;
      },
    );

    // Verify usage snapshot through service
    const usage = await service.getTenantUsage(mockTenant.id);
    assert.equal(usage.usedBytes, 300);
    assert.equal(usage.fileCount, 1);
    assert.equal(usage.monthlyWriteOps, 1);
  });
});
