/**
 * Multi-Tenant Quota & Metering Durable Object (SQLite Backed)
 *
 * Provides strongly-consistent, race-free byte reservations and Class A / Class B
 * operation counters per tenant.
 *
 * Cloudflare Workers Free Tier:
 * - 100k requests/day, 13k GB-s/day, 5M SQL reads/day, 100k SQL writes/day, 5 GB storage.
 *
 * Tenant Free Plan Limits:
 * - Storage Limit: 512 MB (536,870,912 bytes)
 * - Monthly Class A Operations (PUT, COPY, DELETE, LIST): 100,000
 * - Monthly Class B Operations (GET, HEAD): 100,000
 */

import { STORAGE_PLANS } from "./schema";

export interface QuotaCheckResult {
  ok: boolean;
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  reason?: "STORAGE_QUOTA_EXCEEDED" | "MONTHLY_WRITE_QUOTA_EXCEEDED" | "MONTHLY_READ_QUOTA_EXCEEDED";
}

export interface OperationQuotaResult {
  ok: boolean;
  count: number;
  limit: number;
  reason?: "MONTHLY_WRITE_QUOTA_EXCEEDED" | "MONTHLY_READ_QUOTA_EXCEEDED";
}

export interface TenantUsageSnapshot {
  usedBytes: number;
  fileCount: number;
  storageLimitBytes: number;
  currentMonth: string;
  monthlyReadOps: number;
  monthlyWriteOps: number;
  monthlyReadLimitOps: number;
  monthlyWriteLimitOps: number;
}

export interface UnflushedUsageEvent {
  id?: number;
  timestamp: string;
  eventType: "read" | "write" | "delete" | "list" | "copy" | "egress";
  classType: "class_a" | "class_b";
  bytes: number;
  ops: number;
}

export interface TenantMeterInterface {
  reserveBytes(incomingBytes: number, limitBytes?: number): Promise<QuotaCheckResult>;
  commitBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }>;
  releaseBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }>;
  deleteFile(bytes: number): Promise<{ usedBytes: number; fileCount: number }>;
  recordOperation(
    classType: "class_a" | "class_b",
    eventType: "read" | "write" | "delete" | "list" | "copy",
    bytes?: number,
    limit?: number,
  ): Promise<OperationQuotaResult>;
  checkOperationQuota(classType: "class_a" | "class_b", limit?: number): Promise<OperationQuotaResult>;
  getUsage(): Promise<TenantUsageSnapshot>;
  reconcile(actualBytes: number, actualFileCount: number): Promise<void>;
  drainUnflushedEvents(): Promise<UnflushedUsageEvent[]>;
}

function getCurrentMonth(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Cloudflare SQLite-backed Durable Object implementation.
 */
export class TenantMeterDO implements TenantMeterInterface {
  private ctx: any;
  private env: any;
  private initialized = false;

  constructor(ctx: any, env: any) {
    this.ctx = ctx;
    this.env = env;
  }

  private ensureSchema(): void {
    if (this.initialized) return;
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS tenant_meter (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS monthly_ops (
          period TEXT NOT NULL,
          op_class TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (period, op_class)
        );
        CREATE TABLE IF NOT EXISTS unflushed_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT NOT NULL,
          event_type TEXT NOT NULL,
          class_type TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          ops INTEGER NOT NULL DEFAULT 1
        );
      `);
    }
    this.initialized = true;
  }

  private getMeterVal(key: string, defaultVal = 0): number {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return defaultVal;
    const cursor = this.ctx.storage.sql.exec("SELECT value FROM tenant_meter WHERE key = ?", key);
    for (const row of cursor) {
      return Number(row.value) || 0;
    }
    return defaultVal;
  }

  private setMeterVal(key: string, value: number): void {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO tenant_meter (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private getMonthlyOps(period: string, opClass: "class_a" | "class_b"): number {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return 0;
    const cursor = this.ctx.storage.sql.exec(
      "SELECT count FROM monthly_ops WHERE period = ? AND op_class = ?",
      period,
      opClass,
    );
    for (const row of cursor) {
      return Number(row.count) || 0;
    }
    return 0;
  }

  private incrementMonthlyOps(period: string, opClass: "class_a" | "class_b", delta = 1): number {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return delta;
    this.ctx.storage.sql.exec(
      `INSERT INTO monthly_ops (period, op_class, count) VALUES (?, ?, ?)
       ON CONFLICT(period, op_class) DO UPDATE SET count = monthly_ops.count + excluded.count`,
      period,
      opClass,
      delta,
    );
    return this.getMonthlyOps(period, opClass);
  }

  private queueEvent(event: UnflushedUsageEvent): void {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return;
    this.ctx.storage.sql.exec(
      "INSERT INTO unflushed_events (timestamp, event_type, class_type, bytes, ops) VALUES (?, ?, ?, ?, ?)",
      event.timestamp,
      event.eventType,
      event.classType,
      event.bytes,
      event.ops,
    );
  }

  async reserveBytes(incomingBytes: number, limitBytes = STORAGE_PLANS.free.storageLimitBytes): Promise<QuotaCheckResult> {
    this.ensureSchema();
    const currentBytes = this.getMeterVal("bytes_used", 0);
    const newTotal = currentBytes + incomingBytes;

    if (newTotal > limitBytes) {
      return {
        ok: false,
        usedBytes: currentBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - currentBytes),
        reason: "STORAGE_QUOTA_EXCEEDED",
      };
    }

    this.setMeterVal("bytes_used", newTotal);
    const currentFiles = this.getMeterVal("file_count", 0);
    this.setMeterVal("file_count", currentFiles + 1);

    return {
      ok: true,
      usedBytes: newTotal,
      limitBytes,
      remainingBytes: limitBytes - newTotal,
    };
  }

  async commitBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    this.ensureSchema();
    const period = getCurrentMonth();
    this.incrementMonthlyOps(period, "class_a", 1);

    this.queueEvent({
      timestamp: new Date().toISOString(),
      eventType: "write",
      classType: "class_a",
      bytes,
      ops: 1,
    });

    return {
      usedBytes: this.getMeterVal("bytes_used", 0),
      fileCount: this.getMeterVal("file_count", 0),
    };
  }

  async releaseBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    this.ensureSchema();
    const currentBytes = this.getMeterVal("bytes_used", 0);
    const newBytes = Math.max(0, currentBytes - bytes);
    this.setMeterVal("bytes_used", newBytes);

    const currentFiles = this.getMeterVal("file_count", 0);
    const newFiles = Math.max(0, currentFiles - 1);
    this.setMeterVal("file_count", newFiles);

    return { usedBytes: newBytes, fileCount: newFiles };
  }

  async deleteFile(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    this.ensureSchema();
    const currentBytes = this.getMeterVal("bytes_used", 0);
    const newBytes = Math.max(0, currentBytes - bytes);
    this.setMeterVal("bytes_used", newBytes);

    const currentFiles = this.getMeterVal("file_count", 0);
    const newFiles = Math.max(0, currentFiles - 1);
    this.setMeterVal("file_count", newFiles);

    const period = getCurrentMonth();
    this.incrementMonthlyOps(period, "class_a", 1);

    this.queueEvent({
      timestamp: new Date().toISOString(),
      eventType: "delete",
      classType: "class_a",
      bytes,
      ops: 1,
    });

    return { usedBytes: newBytes, fileCount: newFiles };
  }

  async checkOperationQuota(
    classType: "class_a" | "class_b",
    limit: number = classType === "class_a"
      ? STORAGE_PLANS.free.monthlyWriteLimitOps
      : STORAGE_PLANS.free.monthlyReadLimitOps,
  ): Promise<OperationQuotaResult> {
    this.ensureSchema();
    const period = getCurrentMonth();
    const current = this.getMonthlyOps(period, classType);

    if (current >= limit) {
      return {
        ok: false,
        count: current,
        limit,
        reason:
          classType === "class_a"
            ? "MONTHLY_WRITE_QUOTA_EXCEEDED"
            : "MONTHLY_READ_QUOTA_EXCEEDED",
      };
    }

    return { ok: true, count: current, limit };
  }

  async recordOperation(
    classType: "class_a" | "class_b",
    eventType: "read" | "write" | "delete" | "list" | "copy",
    bytes = 0,
    limit: number = classType === "class_a"
      ? STORAGE_PLANS.free.monthlyWriteLimitOps
      : STORAGE_PLANS.free.monthlyReadLimitOps,
  ): Promise<OperationQuotaResult> {
    this.ensureSchema();
    const period = getCurrentMonth();
    const current = this.getMonthlyOps(period, classType);

    if (current >= limit) {
      return {
        ok: false,
        count: current,
        limit,
        reason:
          classType === "class_a"
            ? "MONTHLY_WRITE_QUOTA_EXCEEDED"
            : "MONTHLY_READ_QUOTA_EXCEEDED",
      };
    }

    const updated = this.incrementMonthlyOps(period, classType, 1);

    this.queueEvent({
      timestamp: new Date().toISOString(),
      eventType,
      classType,
      bytes,
      ops: 1,
    });

    return { ok: true, count: updated, limit };
  }

  async getUsage(): Promise<TenantUsageSnapshot> {
    this.ensureSchema();
    const period = getCurrentMonth();
    return {
      usedBytes: this.getMeterVal("bytes_used", 0),
      fileCount: this.getMeterVal("file_count", 0),
      storageLimitBytes: this.getMeterVal("storage_limit", STORAGE_PLANS.free.storageLimitBytes),
      currentMonth: period,
      monthlyReadOps: this.getMonthlyOps(period, "class_b"),
      monthlyWriteOps: this.getMonthlyOps(period, "class_a"),
      monthlyReadLimitOps: this.getMeterVal("read_limit", STORAGE_PLANS.free.monthlyReadLimitOps),
      monthlyWriteLimitOps: this.getMeterVal("write_limit", STORAGE_PLANS.free.monthlyWriteLimitOps),
    };
  }

  async reconcile(actualBytes: number, actualFileCount: number): Promise<void> {
    this.ensureSchema();
    this.setMeterVal("bytes_used", Math.max(0, actualBytes));
    this.setMeterVal("file_count", Math.max(0, actualFileCount));
  }

  async drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return [];
    const cursor = this.ctx.storage.sql.exec(
      "SELECT id, timestamp, event_type as eventType, class_type as classType, bytes, ops FROM unflushed_events ORDER BY id ASC LIMIT 500",
    );
    const events: UnflushedUsageEvent[] = [];
    const ids: number[] = [];
    for (const row of cursor) {
      events.push({
        id: Number(row.id),
        timestamp: String(row.timestamp),
        eventType: row.eventType as UnflushedUsageEvent["eventType"],
        classType: row.classType as UnflushedUsageEvent["classType"],
        bytes: Number(row.bytes) || 0,
        ops: Number(row.ops) || 1,
      });
      ids.push(Number(row.id));
    }
    if (ids.length > 0) {
      this.ctx.storage.sql.exec(
        `DELETE FROM unflushed_events WHERE id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      );
    }
    return events;
  }

  /**
   * HTTP handler allowing Worker RPC or standard fetch inspection.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/usage") {
      const usage = await this.getUsage();
      return new Response(JSON.stringify(usage), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/reserve") {
      const body = (await request.json().catch(() => ({}))) as { bytes?: number; limit?: number };
      const res = await this.reserveBytes(body.bytes ?? 0, body.limit);
      return new Response(JSON.stringify(res), {
        status: res.ok ? 200 : 402,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/commit") {
      const body = (await request.json().catch(() => ({}))) as { bytes?: number };
      const res = await this.commitBytes(body.bytes ?? 0);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/release") {
      const body = (await request.json().catch(() => ({}))) as { bytes?: number };
      const res = await this.releaseBytes(body.bytes ?? 0);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/delete") {
      const body = (await request.json().catch(() => ({}))) as { bytes?: number };
      const res = await this.deleteFile(body.bytes ?? 0);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET" && url.pathname === "/check-op") {
      const classType = url.searchParams.get("class") as "class_a" | "class_b";
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam ? Number(limitParam) : undefined;
      const res = await this.checkOperationQuota(classType, limit);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/record-op") {
      const body = (await request.json().catch(() => ({}))) as {
        classType: "class_a" | "class_b";
        eventType: "read" | "write" | "delete" | "list" | "copy";
        bytes?: number;
        limit?: number;
      };
      const res = await this.recordOperation(body.classType, body.eventType, body.bytes, body.limit);
      return new Response(JSON.stringify(res), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/reconcile") {
      const body = (await request.json().catch(() => ({}))) as {
        actualBytes?: number;
        actualFileCount?: number;
      };
      await this.reconcile(body.actualBytes ?? 0, body.actualFileCount ?? 0);
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "POST" && url.pathname === "/drain-events") {
      const events = await this.drainUnflushedEvents();
      return new Response(JSON.stringify(events), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  }
}

/**
 * Universal adapter wrapping a Cloudflare Durable Object stub.
 * Tries direct typed Worker RPC first, then falls back seamlessly to HTTP fetch.
 */
export class DurableObjectAdapter implements TenantMeterInterface {
  constructor(private stub: any) {}

  async reserveBytes(incomingBytes: number, limitBytes = STORAGE_PLANS.free.storageLimitBytes): Promise<QuotaCheckResult> {
    if (typeof this.stub?.reserveBytes === "function") {
      try {
        return await this.stub.reserveBytes(incomingBytes, limitBytes);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/reserve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: incomingBytes, limit: limitBytes }),
    });
    return (await res.json()) as QuotaCheckResult;
  }

  async commitBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    if (typeof this.stub?.commitBytes === "function") {
      try {
        return await this.stub.commitBytes(bytes);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes }),
    });
    return (await res.json()) as { usedBytes: number; fileCount: number };
  }

  async releaseBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    if (typeof this.stub?.releaseBytes === "function") {
      try {
        return await this.stub.releaseBytes(bytes);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes }),
    });
    return (await res.json()) as { usedBytes: number; fileCount: number };
  }

  async deleteFile(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    if (typeof this.stub?.deleteFile === "function") {
      try {
        return await this.stub.deleteFile(bytes);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes }),
    });
    return (await res.json()) as { usedBytes: number; fileCount: number };
  }

  async checkOperationQuota(classType: "class_a" | "class_b", limit?: number): Promise<OperationQuotaResult> {
    if (typeof this.stub?.checkOperationQuota === "function") {
      try {
        return await this.stub.checkOperationQuota(classType, limit);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch(
      `https://meter.internal/check-op?class=${classType}${limit !== undefined ? `&limit=${limit}` : ""}`,
    );
    return (await res.json()) as OperationQuotaResult;
  }

  async recordOperation(
    classType: "class_a" | "class_b",
    eventType: "read" | "write" | "delete" | "list" | "copy",
    bytes = 0,
    limit?: number,
  ): Promise<OperationQuotaResult> {
    if (typeof this.stub?.recordOperation === "function") {
      try {
        return await this.stub.recordOperation(classType, eventType, bytes, limit);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/record-op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classType, eventType, bytes, limit }),
    });
    return (await res.json()) as OperationQuotaResult;
  }

  async getUsage(): Promise<TenantUsageSnapshot> {
    if (typeof this.stub?.getUsage === "function") {
      try {
        return await this.stub.getUsage();
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/usage");
    return (await res.json()) as TenantUsageSnapshot;
  }

  async reconcile(actualBytes: number, actualFileCount: number): Promise<void> {
    if (typeof this.stub?.reconcile === "function") {
      try {
        return await this.stub.reconcile(actualBytes, actualFileCount);
      } catch {
        // Fall back to HTTP fetch
      }
    }
    await this.stub.fetch("https://meter.internal/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actualBytes, actualFileCount }),
    });
  }

  async drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    if (typeof this.stub?.drainUnflushedEvents === "function") {
      try {
        return await this.stub.drainUnflushedEvents();
      } catch {
        // Fall back to HTTP fetch
      }
    }
    const res = await this.stub.fetch("https://meter.internal/drain-events", { method: "POST" });
    return (await res.json()) as UnflushedUsageEvent[];
  }
}

/**
 * In-Memory fallback implementation for unit tests and local Node development.
 */
export class MemoryTenantMeter implements TenantMeterInterface {
  private usedBytes = 0;
  private fileCount = 0;
  private monthlyOps = new Map<string, number>();
  private events: UnflushedUsageEvent[] = [];

  constructor(initialBytes = 0, initialFiles = 0) {
    this.usedBytes = initialBytes;
    this.fileCount = initialFiles;
  }

  async reserveBytes(incomingBytes: number, limitBytes = STORAGE_PLANS.free.storageLimitBytes): Promise<QuotaCheckResult> {
    const newTotal = this.usedBytes + incomingBytes;
    if (newTotal > limitBytes) {
      return {
        ok: false,
        usedBytes: this.usedBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - this.usedBytes),
        reason: "STORAGE_QUOTA_EXCEEDED",
      };
    }
    this.usedBytes = newTotal;
    this.fileCount += 1;
    return {
      ok: true,
      usedBytes: newTotal,
      limitBytes,
      remainingBytes: limitBytes - newTotal,
    };
  }

  async commitBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    const period = getCurrentMonth();
    const key = `${period}:class_a`;
    this.monthlyOps.set(key, (this.monthlyOps.get(key) ?? 0) + 1);
    this.events.push({
      timestamp: new Date().toISOString(),
      eventType: "write",
      classType: "class_a",
      bytes,
      ops: 1,
    });
    return { usedBytes: this.usedBytes, fileCount: this.fileCount };
  }

  async releaseBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    this.usedBytes = Math.max(0, this.usedBytes - bytes);
    this.fileCount = Math.max(0, this.fileCount - 1);
    return { usedBytes: this.usedBytes, fileCount: this.fileCount };
  }

  async deleteFile(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    this.usedBytes = Math.max(0, this.usedBytes - bytes);
    this.fileCount = Math.max(0, this.fileCount - 1);
    const period = getCurrentMonth();
    const key = `${period}:class_a`;
    this.monthlyOps.set(key, (this.monthlyOps.get(key) ?? 0) + 1);
    this.events.push({
      timestamp: new Date().toISOString(),
      eventType: "delete",
      classType: "class_a",
      bytes,
      ops: 1,
    });
    return { usedBytes: this.usedBytes, fileCount: this.fileCount };
  }

  async checkOperationQuota(
    classType: "class_a" | "class_b",
    limit: number = classType === "class_a"
      ? STORAGE_PLANS.free.monthlyWriteLimitOps
      : STORAGE_PLANS.free.monthlyReadLimitOps,
  ): Promise<OperationQuotaResult> {
    const period = getCurrentMonth();
    const current = this.monthlyOps.get(`${period}:${classType}`) ?? 0;
    if (current >= limit) {
      return {
        ok: false,
        count: current,
        limit,
        reason:
          classType === "class_a"
            ? "MONTHLY_WRITE_QUOTA_EXCEEDED"
            : "MONTHLY_READ_QUOTA_EXCEEDED",
      };
    }
    return { ok: true, count: current, limit };
  }

  async recordOperation(
    classType: "class_a" | "class_b",
    eventType: "read" | "write" | "delete" | "list" | "copy",
    bytes = 0,
    limit: number = classType === "class_a"
      ? STORAGE_PLANS.free.monthlyWriteLimitOps
      : STORAGE_PLANS.free.monthlyReadLimitOps,
  ): Promise<OperationQuotaResult> {
    const period = getCurrentMonth();
    const key = `${period}:${classType}`;
    const current = this.monthlyOps.get(key) ?? 0;
    if (current >= limit) {
      return {
        ok: false,
        count: current,
        limit,
        reason:
          classType === "class_a"
            ? "MONTHLY_WRITE_QUOTA_EXCEEDED"
            : "MONTHLY_READ_QUOTA_EXCEEDED",
      };
    }
    const updated = current + 1;
    this.monthlyOps.set(key, updated);
    this.events.push({
      timestamp: new Date().toISOString(),
      eventType,
      classType,
      bytes,
      ops: 1,
    });
    return { ok: true, count: updated, limit };
  }

  async getUsage(): Promise<TenantUsageSnapshot> {
    const period = getCurrentMonth();
    return {
      usedBytes: this.usedBytes,
      fileCount: this.fileCount,
      storageLimitBytes: STORAGE_PLANS.free.storageLimitBytes,
      currentMonth: period,
      monthlyReadOps: this.monthlyOps.get(`${period}:class_b`) ?? 0,
      monthlyWriteOps: this.monthlyOps.get(`${period}:class_a`) ?? 0,
      monthlyReadLimitOps: STORAGE_PLANS.free.monthlyReadLimitOps,
      monthlyWriteLimitOps: STORAGE_PLANS.free.monthlyWriteLimitOps,
    };
  }

  async reconcile(actualBytes: number, actualFileCount: number): Promise<void> {
    this.usedBytes = Math.max(0, actualBytes);
    this.fileCount = Math.max(0, actualFileCount);
  }

  async drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    const drained = [...this.events];
    this.events = [];
    return drained;
  }

  clear() {
    this.usedBytes = 0;
    this.fileCount = 0;
    this.monthlyOps.clear();
    this.events = [];
  }
}

const memoryMeters = new Map<string, MemoryTenantMeter>();

/**
 * Factory to get or create the tenant meter.
 *
 * In Cloudflare Workers production:
 *   Resolves via env.STORAGE_METER.idFromName(tenantId).
 * In Node tests and local dev:
 *   Resolves to an isolated MemoryTenantMeter.
 */
export async function getTenantMeter(tenantId: string): Promise<TenantMeterInterface> {
  try {
    const { env } = await import("cloudflare:workers");
    const namespace = (env as unknown as Record<string, any>).STORAGE_METER;
    if (namespace && typeof namespace.idFromName === "function") {
      const id = namespace.idFromName(tenantId);
      const stub = namespace.get(id);
      return new DurableObjectAdapter(stub);
    }
  } catch {
    // Cloudflare Workers environment not available
  }

  let meter = memoryMeters.get(tenantId);
  if (!meter) {
    meter = new MemoryTenantMeter();
    memoryMeters.set(tenantId, meter);
  }
  return meter;
}

/**
 * Resets in-memory tenant meters (for test suites).
 */
export function resetMemoryTenantMeters(): void {
  for (const meter of memoryMeters.values()) {
    meter.clear();
  }
  memoryMeters.clear();
}
