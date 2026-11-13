/**
 * Multi-Tenant Quota & Metering Durable Object (SQLite Backed)
 *
 * Provides strongly-consistent, race-free byte reservations (with reservation ID,
 * TTL expiration, idempotency key deduplication, and overwrite delta accounting),
 * Class A / Class B operation counters per tenant, and an acknowledged two-phase
 * outbox (`claimEvents` / `ackEvents` / `nackEvents`) so usage events are never
 * lost if downstream persistence fails.
 */

import { STORAGE_PLANS } from "./schema";
import { generateUsageEventId } from "./keys";

export interface QuotaCheckResult {
  ok: boolean;
  usedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  reason?:
    | "STORAGE_QUOTA_EXCEEDED"
    | "MONTHLY_WRITE_QUOTA_EXCEEDED"
    | "MONTHLY_READ_QUOTA_EXCEEDED";
}

export interface OperationQuotaResult {
  ok: boolean;
  count: number;
  limit: number;
  reason?: "MONTHLY_WRITE_QUOTA_EXCEEDED" | "MONTHLY_READ_QUOTA_EXCEEDED";
}

export interface TenantUsageSnapshot {
  usedBytes: number;
  reservedBytes?: number;
  fileCount: number;
  storageLimitBytes: number;
  currentMonth: string;
  monthlyReadOps: number;
  monthlyWriteOps: number;
  monthlyReadLimitOps: number;
  monthlyWriteLimitOps: number;
}

export interface UnflushedUsageEvent {
  id?: number | string;
  timestamp: string;
  eventType: "read" | "write" | "delete" | "list" | "copy" | "egress";
  classType: "class_a" | "class_b";
  bytes: number;
  ops: number;
  status?: "pending" | "claimed";
  claimedAt?: number | null;
  attempts?: number;
}

export interface StorageReservation {
  id: string;
  requestedBytes: number;
  existingBytes: number;
  deltaBytes: number;
  isOverwrite: boolean;
  limitBytes: number;
  objectKey?: string;
  idempotencyKey?: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "committed" | "released";
}

export interface CreateReservationInput {
  requestedBytes: number;
  existingBytes?: number;
  isOverwrite?: boolean;
  limitBytes?: number;
  objectKey?: string;
  idempotencyKey?: string;
  ttlMs?: number;
}

export interface CreateReservationResult {
  ok: boolean;
  reservation?: StorageReservation;
  usedBytes: number;
  reservedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  reason?: "STORAGE_QUOTA_EXCEEDED";
}

export interface TenantMeterInterface {
  createReservation(input: CreateReservationInput): Promise<CreateReservationResult>;
  commitReservation(
    reservationId: string,
    actualBytes?: number,
  ): Promise<{ usedBytes: number; fileCount: number }>;
  releaseReservation(
    reservationId: string,
  ): Promise<{ usedBytes: number; fileCount: number }>;
  cleanupExpiredReservations(): Promise<number>;

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
  checkOperationQuota(
    classType: "class_a" | "class_b",
    limit?: number,
  ): Promise<OperationQuotaResult>;
  getUsage(): Promise<TenantUsageSnapshot>;
  reconcile(actualBytes: number, actualFileCount: number): Promise<void>;

  claimEvents(limit?: number): Promise<UnflushedUsageEvent[]>;
  ackEvents(ids: Array<number | string>): Promise<number>;
  nackEvents(ids: Array<number | string>): Promise<number>;
  drainUnflushedEvents(): Promise<UnflushedUsageEvent[]>;
}

const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_OUTBOX_EVENTS = 10_000;

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
  private reservations = new Map<string, StorageReservation>();
  private idempotencyIndex = new Map<string, string>();

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
          ops INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'pending',
          claimed_at INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0
        );
      `);
      try {
        this.ctx.storage.sql.exec(
          `ALTER TABLE unflushed_events ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`,
        );
        this.ctx.storage.sql.exec(
          `ALTER TABLE unflushed_events ADD COLUMN claimed_at INTEGER`,
        );
        this.ctx.storage.sql.exec(
          `ALTER TABLE unflushed_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0`,
        );
      } catch {
        // Columns already exist
      }
    }
    this.initialized = true;
  }

  private getMeterVal(key: string, defaultVal = 0): number {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return defaultVal;
    const cursor = this.ctx.storage.sql.exec(
      "SELECT value FROM tenant_meter WHERE key = ?",
      key,
    );
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

  private expireReservationsSync(): number {
    const now = Date.now();
    let expired = 0;
    let releasedDelta = 0;
    for (const res of this.reservations.values()) {
      if (res.status === "pending" && res.expiresAt <= now) {
        res.status = "released";
        releasedDelta += Math.max(0, res.deltaBytes);
        expired++;
      }
    }
    if (releasedDelta > 0) {
      const currentReserved = this.getMeterVal("bytes_reserved", 0);
      this.setMeterVal("bytes_reserved", Math.max(0, currentReserved - releasedDelta));
    }
    return expired;
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

  private incrementMonthlyOps(
    period: string,
    opClass: "class_a" | "class_b",
    delta = 1,
  ): number {
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
      "INSERT INTO unflushed_events (timestamp, event_type, class_type, bytes, ops, status, attempts) VALUES (?, ?, ?, ?, ?, 'pending', 0)",
      event.timestamp,
      event.eventType,
      event.classType,
      event.bytes,
      event.ops,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM unflushed_events WHERE id IN (
        SELECT id FROM unflushed_events ORDER BY id DESC LIMIT -1 OFFSET ?
      )`,
      MAX_OUTBOX_EVENTS,
    );
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<CreateReservationResult> {
    this.ensureSchema();
    this.expireReservationsSync();

    const requestedBytes = Math.max(0, input.requestedBytes);
    const existingBytes = Math.max(0, input.existingBytes ?? 0);
    const isOverwrite = Boolean(input.isOverwrite);
    const limitBytes = input.limitBytes ?? STORAGE_PLANS.free.storageLimitBytes;
    const ttlMs = Math.max(1000, input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS);

    const usedBytes = this.getMeterVal("bytes_used", 0);
    const reservedBytes = this.getMeterVal("bytes_reserved", 0);

    if (input.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(input.idempotencyKey);
      if (existingId) {
        const existingRes = this.reservations.get(existingId);
        if (existingRes && existingRes.status !== "released") {
          return {
            ok: true,
            reservation: { ...existingRes },
            usedBytes,
            reservedBytes,
            limitBytes,
            remainingBytes: Math.max(0, limitBytes - usedBytes - reservedBytes),
          };
        }
      }
    }

    const deltaBytes = isOverwrite ? requestedBytes - existingBytes : requestedBytes;
    const positiveDelta = Math.max(0, deltaBytes);

    if (usedBytes + reservedBytes + positiveDelta > limitBytes) {
      return {
        ok: false,
        usedBytes,
        reservedBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - usedBytes - reservedBytes),
        reason: "STORAGE_QUOTA_EXCEEDED",
      };
    }

    const now = Date.now();
    const reservation: StorageReservation = {
      id: generateUsageEventId(),
      requestedBytes,
      existingBytes,
      deltaBytes,
      isOverwrite,
      limitBytes,
      objectKey: input.objectKey,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      expiresAt: now + ttlMs,
      status: "pending",
    };

    this.reservations.set(reservation.id, reservation);
    if (input.idempotencyKey) {
      this.idempotencyIndex.set(input.idempotencyKey, reservation.id);
    }

    const newReserved = reservedBytes + positiveDelta;
    this.setMeterVal("bytes_reserved", newReserved);

    return {
      ok: true,
      reservation: { ...reservation },
      usedBytes,
      reservedBytes: newReserved,
      limitBytes,
      remainingBytes: Math.max(0, limitBytes - usedBytes - newReserved),
    };
  }

  async commitReservation(
    reservationId: string,
    actualBytes?: number,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    this.ensureSchema();
    const res = this.reservations.get(reservationId);
    if (!res || res.status === "committed") {
      return {
        usedBytes: this.getMeterVal("bytes_used", 0),
        fileCount: this.getMeterVal("file_count", 0),
      };
    }

    const finalBytes = Math.max(0, actualBytes ?? res.requestedBytes);
    const positiveReserved = Math.max(0, res.deltaBytes);
    const actualDelta = res.isOverwrite ? finalBytes - res.existingBytes : finalBytes;

    const currentUsed = this.getMeterVal("bytes_used", 0);
    const currentReserved = this.getMeterVal("bytes_reserved", 0);

    // Check if final streamed size exceeded quota beyond what was reserved
    if (currentUsed + actualDelta > res.limitBytes) {
      res.status = "released";
      this.setMeterVal("bytes_reserved", Math.max(0, currentReserved - positiveReserved));
      throw new Error("STORAGE_QUOTA_EXCEEDED");
    }

    res.status = "committed";
    this.setMeterVal("bytes_reserved", Math.max(0, currentReserved - positiveReserved));
    const newUsed = Math.max(0, currentUsed + actualDelta);
    this.setMeterVal("bytes_used", newUsed);

    let fileCount = this.getMeterVal("file_count", 0);
    if (!res.isOverwrite) {
      fileCount += 1;
      this.setMeterVal("file_count", fileCount);
    }

    const period = getCurrentMonth();
    this.incrementMonthlyOps(period, "class_a", 1);

    this.queueEvent({
      timestamp: new Date().toISOString(),
      eventType: "write",
      classType: "class_a",
      bytes: finalBytes,
      ops: 1,
    });

    return { usedBytes: newUsed, fileCount };
  }

  async releaseReservation(
    reservationId: string,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    this.ensureSchema();
    const res = this.reservations.get(reservationId);
    if (res && res.status === "pending") {
      res.status = "released";
      const positiveReserved = Math.max(0, res.deltaBytes);
      const currentReserved = this.getMeterVal("bytes_reserved", 0);
      this.setMeterVal("bytes_reserved", Math.max(0, currentReserved - positiveReserved));
    }
    return {
      usedBytes: this.getMeterVal("bytes_used", 0),
      fileCount: this.getMeterVal("file_count", 0),
    };
  }

  async cleanupExpiredReservations(): Promise<number> {
    this.ensureSchema();
    return this.expireReservationsSync();
  }

  async reserveBytes(
    incomingBytes: number,
    limitBytes = STORAGE_PLANS.free.storageLimitBytes,
  ): Promise<QuotaCheckResult> {
    this.ensureSchema();
    this.expireReservationsSync();
    const currentBytes = this.getMeterVal("bytes_used", 0);
    const reservedBytes = this.getMeterVal("bytes_reserved", 0);
    const newTotal = currentBytes + incomingBytes;

    if (newTotal + reservedBytes > limitBytes) {
      return {
        ok: false,
        usedBytes: currentBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - currentBytes - reservedBytes),
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
    this.expireReservationsSync();
    const period = getCurrentMonth();
    return {
      usedBytes: this.getMeterVal("bytes_used", 0),
      reservedBytes: this.getMeterVal("bytes_reserved", 0),
      fileCount: this.getMeterVal("file_count", 0),
      storageLimitBytes: STORAGE_PLANS.free.storageLimitBytes,
      currentMonth: period,
      monthlyReadOps: this.getMonthlyOps(period, "class_b"),
      monthlyWriteOps: this.getMonthlyOps(period, "class_a"),
      monthlyReadLimitOps: STORAGE_PLANS.free.monthlyReadLimitOps,
      monthlyWriteLimitOps: STORAGE_PLANS.free.monthlyWriteLimitOps,
    };
  }

  async reconcile(actualBytes: number, actualFileCount: number): Promise<void> {
    this.ensureSchema();
    this.setMeterVal("bytes_used", Math.max(0, actualBytes));
    this.setMeterVal("file_count", Math.max(0, actualFileCount));
  }

  async claimEvents(limit = 200): Promise<UnflushedUsageEvent[]> {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return [];
    const now = Date.now();
    const staleCutoff = now - CLAIM_TIMEOUT_MS;
    const cursor = this.ctx.storage.sql.exec(
      `SELECT id, timestamp, event_type, class_type, bytes, ops, attempts
       FROM unflushed_events
       WHERE status = 'pending' OR (status = 'claimed' AND claimed_at < ?)
       ORDER BY id ASC LIMIT ?`,
      staleCutoff,
      limit,
    );
    const events: UnflushedUsageEvent[] = [];
    const ids: number[] = [];
    for (const row of cursor) {
      const id = Number(row.id);
      ids.push(id);
      events.push({
        id,
        timestamp: String(row.timestamp),
        eventType: String(row.event_type) as UnflushedUsageEvent["eventType"],
        classType: String(row.class_type) as UnflushedUsageEvent["classType"],
        bytes: Number(row.bytes),
        ops: Number(row.ops),
        status: "claimed",
        claimedAt: now,
        attempts: Number(row.attempts ?? 0) + 1,
      });
    }
    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      this.ctx.storage.sql.exec(
        `UPDATE unflushed_events SET status = 'claimed', claimed_at = ?, attempts = attempts + 1 WHERE id IN (${placeholders})`,
        now,
        ...ids,
      );
    }
    return events;
  }

  async ackEvents(ids: Array<number | string>): Promise<number> {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql || ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    this.ctx.storage.sql.exec(
      `DELETE FROM unflushed_events WHERE id IN (${placeholders})`,
      ...ids,
    );
    return ids.length;
  }

  async nackEvents(ids: Array<number | string>): Promise<number> {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql || ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    this.ctx.storage.sql.exec(
      `UPDATE unflushed_events SET status = 'pending', claimed_at = NULL WHERE id IN (${placeholders})`,
      ...ids,
    );
    return ids.length;
  }

  async drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return [];
    const cursor = this.ctx.storage.sql.exec(
      "SELECT id, timestamp, event_type, class_type, bytes, ops FROM unflushed_events ORDER BY id ASC LIMIT 500",
    );
    const events: UnflushedUsageEvent[] = [];
    const ids: number[] = [];
    for (const row of cursor) {
      ids.push(Number(row.id));
      events.push({
        id: Number(row.id),
        timestamp: String(row.timestamp),
        eventType: String(row.event_type) as UnflushedUsageEvent["eventType"],
        classType: String(row.class_type) as UnflushedUsageEvent["classType"],
        bytes: Number(row.bytes),
        ops: Number(row.ops),
      });
    }
    if (ids.length > 0) {
      this.ctx.storage.sql.exec(
        `DELETE FROM unflushed_events WHERE id IN (${ids.map(() => "?").join(",")})`,
        ...ids,
      );
    }
    return events;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/create-reservation" && request.method === "POST") {
        const body = (await request.json()) as CreateReservationInput;
        return Response.json(await this.createReservation(body));
      }
      if (path === "/commit-reservation" && request.method === "POST") {
        const body = (await request.json()) as {
          reservationId: string;
          actualBytes?: number;
        };
        return Response.json(
          await this.commitReservation(body.reservationId, body.actualBytes),
        );
      }
      if (path === "/release-reservation" && request.method === "POST") {
        const body = (await request.json()) as { reservationId: string };
        return Response.json(await this.releaseReservation(body.reservationId));
      }
      if (path === "/cleanup-reservations" && request.method === "POST") {
        return Response.json({ expired: await this.cleanupExpiredReservations() });
      }
      if (path === "/reserve" && request.method === "POST") {
        const { incomingBytes, limitBytes } = (await request.json()) as {
          incomingBytes: number;
          limitBytes?: number;
        };
        return Response.json(await this.reserveBytes(incomingBytes, limitBytes));
      }
      if (path === "/commit" && request.method === "POST") {
        const { bytes } = (await request.json()) as { bytes: number };
        return Response.json(await this.commitBytes(bytes));
      }
      if (path === "/release" && request.method === "POST") {
        const { bytes } = (await request.json()) as { bytes: number };
        return Response.json(await this.releaseBytes(bytes));
      }
      if (path === "/delete" && request.method === "POST") {
        const { bytes } = (await request.json()) as { bytes: number };
        return Response.json(await this.deleteFile(bytes));
      }
      if (path === "/record-op" && request.method === "POST") {
        const { classType, eventType, bytes, limit } = (await request.json()) as {
          classType: "class_a" | "class_b";
          eventType: "read" | "write" | "delete" | "list" | "copy";
          bytes?: number;
          limit?: number;
        };
        return Response.json(
          await this.recordOperation(classType, eventType, bytes, limit),
        );
      }
      if (path === "/check-op" && request.method === "POST") {
        const { classType, limit } = (await request.json()) as {
          classType: "class_a" | "class_b";
          limit?: number;
        };
        return Response.json(await this.checkOperationQuota(classType, limit));
      }
      if (path === "/usage" && request.method === "GET") {
        return Response.json(await this.getUsage());
      }
      if (path === "/reconcile" && request.method === "POST") {
        const { actualBytes, actualFileCount } = (await request.json()) as {
          actualBytes: number;
          actualFileCount: number;
        };
        await this.reconcile(actualBytes, actualFileCount);
        return Response.json({ ok: true });
      }
      if (path === "/claim" && request.method === "POST") {
        const { limit } = (await request.json().catch(() => ({}))) as {
          limit?: number;
        };
        return Response.json(await this.claimEvents(limit));
      }
      if (path === "/ack" && request.method === "POST") {
        const { ids } = (await request.json()) as { ids: Array<number | string> };
        return Response.json({ acked: await this.ackEvents(ids) });
      }
      if (path === "/nack" && request.method === "POST") {
        const { ids } = (await request.json()) as { ids: Array<number | string> };
        return Response.json({ nacked: await this.nackEvents(ids) });
      }
      if (path === "/drain" && request.method === "POST") {
        return Response.json(await this.drainUnflushedEvents());
      }
      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }
}

/**
 * Adapter that wraps a Cloudflare DurableObjectStub to implement TenantMeterInterface via RPC/fetch.
 */
export class DurableObjectAdapter implements TenantMeterInterface {
  private stub: any;

  constructor(stub: any) {
    this.stub = stub;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.stub.fetch(`https://meter.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`TenantMeterDO RPC failed (${res.status}): ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  createReservation(input: CreateReservationInput): Promise<CreateReservationResult> {
    return this.post("/create-reservation", input);
  }

  commitReservation(
    reservationId: string,
    actualBytes?: number,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    return this.post("/commit-reservation", { reservationId, actualBytes });
  }

  releaseReservation(
    reservationId: string,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    return this.post("/release-reservation", { reservationId });
  }

  async cleanupExpiredReservations(): Promise<number> {
    const res = await this.post<{ expired: number }>("/cleanup-reservations", {});
    return res.expired;
  }

  reserveBytes(incomingBytes: number, limitBytes?: number): Promise<QuotaCheckResult> {
    return this.post("/reserve", { incomingBytes, limitBytes });
  }

  commitBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    return this.post("/commit", { bytes });
  }

  releaseBytes(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    return this.post("/release", { bytes });
  }

  deleteFile(bytes: number): Promise<{ usedBytes: number; fileCount: number }> {
    return this.post("/delete", { bytes });
  }

  recordOperation(
    classType: "class_a" | "class_b",
    eventType: "read" | "write" | "delete" | "list" | "copy",
    bytes = 0,
    limit?: number,
  ): Promise<OperationQuotaResult> {
    return this.post("/record-op", { classType, eventType, bytes, limit });
  }

  checkOperationQuota(
    classType: "class_a" | "class_b",
    limit?: number,
  ): Promise<OperationQuotaResult> {
    return this.post("/check-op", { classType, limit });
  }

  async getUsage(): Promise<TenantUsageSnapshot> {
    const res = await this.stub.fetch("https://meter.internal/usage", { method: "GET" });
    if (!res.ok) {
      throw new Error(`TenantMeterDO getUsage failed (${res.status})`);
    }
    return (await res.json()) as TenantUsageSnapshot;
  }

  async reconcile(actualBytes: number, actualFileCount: number): Promise<void> {
    await this.post("/reconcile", { actualBytes, actualFileCount });
  }

  claimEvents(limit = 200): Promise<UnflushedUsageEvent[]> {
    return this.post("/claim", { limit });
  }

  async ackEvents(ids: Array<number | string>): Promise<number> {
    const res = await this.post<{ acked: number }>("/ack", { ids });
    return res.acked;
  }

  async nackEvents(ids: Array<number | string>): Promise<number> {
    const res = await this.post<{ nacked: number }>("/nack", { ids });
    return res.nacked;
  }

  drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    return this.post("/drain", {});
  }
}

/**
 * In-memory implementation of TenantMeterInterface for local development and tests.
 */
export class MemoryTenantMeter implements TenantMeterInterface {
  private usedBytes = 0;
  private reservedBytes = 0;
  private fileCount = 0;
  private monthlyOps = new Map<string, number>();
  private events: UnflushedUsageEvent[] = [];
  private reservations = new Map<string, StorageReservation>();
  private idempotencyIndex = new Map<string, string>();
  private nextEventId = 1;

  constructor(initialBytes = 0, initialFiles = 0) {
    this.usedBytes = initialBytes;
    this.fileCount = initialFiles;
  }

  private expireReservationsSync(): number {
    const now = Date.now();
    let expired = 0;
    for (const res of this.reservations.values()) {
      if (res.status === "pending" && res.expiresAt <= now) {
        res.status = "released";
        const positiveDelta = Math.max(0, res.deltaBytes);
        this.reservedBytes = Math.max(0, this.reservedBytes - positiveDelta);
        expired++;
      }
    }
    return expired;
  }

  private pushEvent(
    eventType: UnflushedUsageEvent["eventType"],
    classType: UnflushedUsageEvent["classType"],
    bytes: number,
    ops = 1,
  ): void {
    this.events.push({
      id: this.nextEventId++,
      timestamp: new Date().toISOString(),
      eventType,
      classType,
      bytes,
      ops,
      status: "pending",
      claimedAt: null,
      attempts: 0,
    });
    if (this.events.length > MAX_OUTBOX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_OUTBOX_EVENTS);
    }
  }

  async createReservation(
    input: CreateReservationInput,
  ): Promise<CreateReservationResult> {
    this.expireReservationsSync();
    const requestedBytes = Math.max(0, input.requestedBytes);
    const existingBytes = Math.max(0, input.existingBytes ?? 0);
    const isOverwrite = Boolean(input.isOverwrite);
    const limitBytes = input.limitBytes ?? STORAGE_PLANS.free.storageLimitBytes;
    const ttlMs = Math.max(1000, input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS);

    if (input.idempotencyKey) {
      const existingId = this.idempotencyIndex.get(input.idempotencyKey);
      if (existingId) {
        const existingRes = this.reservations.get(existingId);
        if (existingRes && existingRes.status !== "released") {
          return {
            ok: true,
            reservation: { ...existingRes },
            usedBytes: this.usedBytes,
            reservedBytes: this.reservedBytes,
            limitBytes,
            remainingBytes: Math.max(
              0,
              limitBytes - this.usedBytes - this.reservedBytes,
            ),
          };
        }
      }
    }

    const deltaBytes = isOverwrite ? requestedBytes - existingBytes : requestedBytes;
    const positiveDelta = Math.max(0, deltaBytes);

    if (this.usedBytes + this.reservedBytes + positiveDelta > limitBytes) {
      return {
        ok: false,
        usedBytes: this.usedBytes,
        reservedBytes: this.reservedBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - this.usedBytes - this.reservedBytes),
        reason: "STORAGE_QUOTA_EXCEEDED",
      };
    }

    const now = Date.now();
    const reservation: StorageReservation = {
      id: generateUsageEventId(),
      requestedBytes,
      existingBytes,
      deltaBytes,
      isOverwrite,
      limitBytes,
      objectKey: input.objectKey,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      expiresAt: now + ttlMs,
      status: "pending",
    };

    this.reservations.set(reservation.id, reservation);
    if (input.idempotencyKey) {
      this.idempotencyIndex.set(input.idempotencyKey, reservation.id);
    }

    this.reservedBytes += positiveDelta;

    return {
      ok: true,
      reservation: { ...reservation },
      usedBytes: this.usedBytes,
      reservedBytes: this.reservedBytes,
      limitBytes,
      remainingBytes: Math.max(0, limitBytes - this.usedBytes - this.reservedBytes),
    };
  }

  async commitReservation(
    reservationId: string,
    actualBytes?: number,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    const res = this.reservations.get(reservationId);
    if (!res || res.status === "committed") {
      return { usedBytes: this.usedBytes, fileCount: this.fileCount };
    }

    const finalBytes = Math.max(0, actualBytes ?? res.requestedBytes);
    const positiveReserved = Math.max(0, res.deltaBytes);
    const actualDelta = res.isOverwrite ? finalBytes - res.existingBytes : finalBytes;

    if (this.usedBytes + actualDelta > res.limitBytes) {
      res.status = "released";
      this.reservedBytes = Math.max(0, this.reservedBytes - positiveReserved);
      throw new Error("STORAGE_QUOTA_EXCEEDED");
    }

    res.status = "committed";
    this.reservedBytes = Math.max(0, this.reservedBytes - positiveReserved);
    this.usedBytes = Math.max(0, this.usedBytes + actualDelta);
    if (!res.isOverwrite) {
      this.fileCount += 1;
    }

    const period = getCurrentMonth();
    const key = `${period}:class_a`;
    this.monthlyOps.set(key, (this.monthlyOps.get(key) ?? 0) + 1);
    this.pushEvent("write", "class_a", finalBytes, 1);

    return { usedBytes: this.usedBytes, fileCount: this.fileCount };
  }

  async releaseReservation(
    reservationId: string,
  ): Promise<{ usedBytes: number; fileCount: number }> {
    const res = this.reservations.get(reservationId);
    if (res && res.status === "pending") {
      res.status = "released";
      const positiveReserved = Math.max(0, res.deltaBytes);
      this.reservedBytes = Math.max(0, this.reservedBytes - positiveReserved);
    }
    return { usedBytes: this.usedBytes, fileCount: this.fileCount };
  }

  async cleanupExpiredReservations(): Promise<number> {
    return this.expireReservationsSync();
  }

  async reserveBytes(
    incomingBytes: number,
    limitBytes = STORAGE_PLANS.free.storageLimitBytes,
  ): Promise<QuotaCheckResult> {
    this.expireReservationsSync();
    const newTotal = this.usedBytes + incomingBytes;
    if (newTotal + this.reservedBytes > limitBytes) {
      return {
        ok: false,
        usedBytes: this.usedBytes,
        limitBytes,
        remainingBytes: Math.max(0, limitBytes - this.usedBytes - this.reservedBytes),
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
    this.pushEvent("write", "class_a", bytes, 1);
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
    this.pushEvent("delete", "class_a", bytes, 1);
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
    this.pushEvent(eventType, classType, bytes, 1);
    return { ok: true, count: updated, limit };
  }

  async getUsage(): Promise<TenantUsageSnapshot> {
    this.expireReservationsSync();
    const period = getCurrentMonth();
    return {
      usedBytes: this.usedBytes,
      reservedBytes: this.reservedBytes,
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

  async claimEvents(limit = 200): Promise<UnflushedUsageEvent[]> {
    const now = Date.now();
    const staleCutoff = now - CLAIM_TIMEOUT_MS;
    const claimed: UnflushedUsageEvent[] = [];
    for (const evt of this.events) {
      if (claimed.length >= limit) break;
      if (
        evt.status !== "claimed" ||
        (evt.claimedAt !== null &&
          evt.claimedAt !== undefined &&
          evt.claimedAt < staleCutoff)
      ) {
        evt.status = "claimed";
        evt.claimedAt = now;
        evt.attempts = (evt.attempts ?? 0) + 1;
        claimed.push({ ...evt });
      }
    }
    return claimed;
  }

  async ackEvents(ids: Array<number | string>): Promise<number> {
    if (ids.length === 0) return 0;
    const idSet = new Set(ids.map((id) => String(id)));
    const before = this.events.length;
    this.events = this.events.filter((e) => !idSet.has(String(e.id)));
    return before - this.events.length;
  }

  async nackEvents(ids: Array<number | string>): Promise<number> {
    if (ids.length === 0) return 0;
    const idSet = new Set(ids.map((id) => String(id)));
    let nacked = 0;
    for (const evt of this.events) {
      if (idSet.has(String(evt.id))) {
        evt.status = "pending";
        evt.claimedAt = null;
        nacked++;
      }
    }
    return nacked;
  }

  async drainUnflushedEvents(): Promise<UnflushedUsageEvent[]> {
    const drained = [...this.events];
    this.events = [];
    return drained;
  }

  clear() {
    this.usedBytes = 0;
    this.reservedBytes = 0;
    this.fileCount = 0;
    this.monthlyOps.clear();
    this.events = [];
    this.reservations.clear();
    this.idempotencyIndex.clear();
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
