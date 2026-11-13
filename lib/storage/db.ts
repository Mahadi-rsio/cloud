/**
 * Storage database module — delegates to the main Drizzle/Neon Postgres client
 * from `@/lib/db`, and provides a deterministic in-memory Drizzle-compatible
 * fallback when running in test mode (`VITEST` / `NODE_ENV === "test"` or when
 * `resetStorageDb()` is called) so unit/integration tests run offline.
 */

import { getDb } from "@/lib/db";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as storageSchema from "./schema";

export type StorageDb = NeonHttpDatabase<typeof storageSchema>;

let _overrideDb: StorageDb | undefined;
let _useMemoryDb = Boolean(process.env.VITEST || process.env.NODE_ENV === "test");

export interface StorageDbConfig {
  url?: string;
  authToken?: string;
}

type Row = Record<string, unknown>;

interface TableStore {
  tenants: Row[];
  projects: Row[];
  apiKeys: Row[];
  usageDaily: Row[];
  usageEvents: Row[];
  auditLog: Row[];
}

const memoryStore: TableStore = {
  tenants: [],
  projects: [],
  apiKeys: [],
  usageDaily: [],
  usageEvents: [],
  auditLog: [],
};

function getTableRows(table: unknown): Row[] {
  if (table === storageSchema.tenants) return memoryStore.tenants;
  if (table === storageSchema.projects) return memoryStore.projects;
  if (table === storageSchema.apiKeys) return memoryStore.apiKeys;
  if (table === storageSchema.usageDaily) return memoryStore.usageDaily;
  if (table === storageSchema.usageEvents) return memoryStore.usageEvents;
  if (table === storageSchema.auditLog) return memoryStore.auditLog;
  throw new Error("Unsupported table in memory StorageDb");
}

function getColumnPropName(col: unknown): string | null {
  if (!col || typeof col !== "object") return null;
  const c = col as { name?: string };
  if (!c.name) return null;
  return c.name.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

function extractPredicate(expr: unknown): (row: Row) => boolean {
  if (!expr || typeof expr !== "object") return () => true;
  const chunks = (expr as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return () => true;

  const subExprs = chunks.filter(
    (ch) =>
      ch &&
      typeof ch === "object" &&
      Array.isArray((ch as { queryChunks?: unknown[] }).queryChunks),
  );
  if (subExprs.length > 0) {
    const preds = subExprs.map((s) => extractPredicate(s));
    return (row) => preds.every((p) => p(row));
  }

  let colProp: string | null = null;
  let paramVal: unknown = undefined;
  let hasParam = false;
  let sqlText = "";

  for (const ch of chunks) {
    if (!ch || typeof ch !== "object") continue;
    const obj = ch as { name?: string; value?: unknown; table?: unknown };
    if (Array.isArray(obj.value)) {
      sqlText += obj.value.join("");
    } else if (typeof obj.name === "string" && obj.table) {
      colProp = getColumnPropName(obj);
    } else if ("value" in obj && "encoder" in obj) {
      paramVal = obj.value;
      hasParam = true;
    }
  }

  if (colProp && hasParam) {
    if (sqlText.includes(">=")) {
      return (row) => String(row[colProp!] ?? "") >= String(paramVal ?? "");
    }
    if (sqlText.includes("<=")) {
      return (row) => String(row[colProp!] ?? "") <= String(paramVal ?? "");
    }
    if (sqlText.includes("=")) {
      return (row) => row[colProp!] === paramVal;
    }
  }
  if (colProp && sqlText.toLowerCase().includes("is null")) {
    return (row) => row[colProp!] === null || row[colProp!] === undefined;
  }
  return () => true;
}

function applyDefaults(table: unknown, values: Row): Row {
  const now = new Date().toISOString();
  if (table === storageSchema.tenants) {
    return {
      status: "trial",
      plan: "free",
      storageLimitBytes: 512 * 1024 * 1024,
      storageUsedBytes: 0,
      fileCount: 0,
      monthlyReadLimitOps: 100_000,
      monthlyWriteLimitOps: 100_000,
      bandwidthLimitBytes: 5 * 1024 * 1024 * 1024,
      egressRateLimitMbps: 100,
      trialEndsAt: null,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
  }
  if (table === storageSchema.projects) {
    return {
      createdAt: now,
      updatedAt: now,
      ...values,
    };
  }
  if (table === storageSchema.apiKeys) {
    return {
      projectId: null,
      scopes: "storage:read,storage:write",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: now,
      ...values,
    };
  }
  if (table === storageSchema.usageDaily) {
    return {
      projectId: "",
      storageBytesAvg: 0,
      storageBytesPeak: 0,
      fileCount: 0,
      egressBytes: 0,
      ingressBytes: 0,
      readOps: 0,
      writeOps: 0,
      deleteOps: 0,
      updatedAt: now,
      ...values,
    };
  }
  if (table === storageSchema.usageEvents) {
    return {
      projectId: null,
      classType: "class_b",
      bytes: 0,
      ops: 1,
      timestamp: now,
      ...values,
    };
  }
  if (table === storageSchema.auditLog) {
    return {
      metadata: null,
      ipAddress: null,
      userAgent: null,
      createdAt: now,
      ...values,
    };
  }
  return { ...values };
}

function createMemoryStorageDb(): StorageDb {
  const db = {
    select() {
      return {
        from(table: unknown) {
          let rows = [...getTableRows(table)];
          const query = {
            where(expr: unknown) {
              const pred = extractPredicate(expr);
              rows = rows.filter(pred);
              return query;
            },
            orderBy(..._args: unknown[]) {
              rows = [...rows].reverse();
              return query;
            },
            limit(n: number) {
              rows = rows.slice(0, n);
              return query;
            },
            then<TResult1 = Row[], TResult2 = never>(
              onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ): Promise<TResult1 | TResult2> {
              return Promise.resolve(rows.map((r) => ({ ...r }))).then(
                onfulfilled,
                onrejected,
              );
            },
          };
          return query;
        },
      };
    },
    insert(table: unknown) {
      return {
        values(rawValues: Row | Row[]) {
          const items = Array.isArray(rawValues) ? rawValues : [rawValues];
          const rows = getTableRows(table);
          const inserted: Row[] = [];

          const executeInsert = (
            ignoreConflict = false,
            updateSet?: Row,
            conflictTarget?: unknown[],
          ) => {
            for (const item of items) {
              const row = applyDefaults(table, item);
              const existingIdx = rows.findIndex((existing) => {
                if (conflictTarget && conflictTarget.length > 0) {
                  return conflictTarget.every((col) => {
                    const prop = getColumnPropName(col);
                    return prop ? existing[prop] === row[prop] : false;
                  });
                }
                if ("id" in row && row.id !== undefined && existing.id === row.id) {
                  return true;
                }
                if (
                  table === storageSchema.projects &&
                  existing.tenantId === row.tenantId &&
                  existing.name === row.name
                ) {
                  return true;
                }
                if (
                  table === storageSchema.apiKeys &&
                  existing.keyHash === row.keyHash
                ) {
                  return true;
                }
                return false;
              });

              if (existingIdx !== -1) {
                if (ignoreConflict) continue;
                if (updateSet) {
                  const existing = rows[existingIdx];
                  Object.assign(existing, updateSet);
                  inserted.push(existing);
                  continue;
                }
                throw new Error("UNIQUE constraint failed");
              }

              rows.push(row);
              inserted.push(row);
            }
            return inserted.map((r) => ({ ...r }));
          };

          return {
            onConflictDoNothing() {
              const res = executeInsert(true);
              const p = Promise.resolve(res);
              return Object.assign(p, {
                returning() {
                  return Promise.resolve(res);
                },
              });
            },
            onConflictDoUpdate(cfg: { target?: unknown[]; set?: Row }) {
              return Promise.resolve(executeInsert(false, cfg.set ?? {}, cfg.target));
            },
            returning() {
              return Promise.resolve(executeInsert(false));
            },
            then<TResult1 = Row[], TResult2 = never>(
              onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ): Promise<TResult1 | TResult2> {
              try {
                const res = executeInsert(false);
                return Promise.resolve(res).then(onfulfilled, onrejected);
              } catch (err) {
                return Promise.reject(err).then(onfulfilled, onrejected);
              }
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(updates: Row) {
          const rows = getTableRows(table);
          const applyUpdates = (pred: (row: Row) => boolean) => {
            const matched: Row[] = [];
            for (const row of rows) {
              if (pred(row)) {
                Object.assign(row, updates);
                matched.push({ ...row });
              }
            }
            return matched;
          };
          return {
            where(expr: unknown) {
              const pred = extractPredicate(expr);
              const updated = applyUpdates(pred);
              const p = Promise.resolve(updated);
              return Object.assign(p, {
                returning() {
                  return Promise.resolve(updated);
                },
              });
            },
          };
        },
      };
    },
    async transaction<T>(fn: (tx: StorageDb) => Promise<T>): Promise<T> {
      return fn(db as unknown as StorageDb);
    },
    delete(table: unknown) {
      const rows = getTableRows(table);
      return {
        where(expr: unknown) {
          const pred = extractPredicate(expr);
          const deleted: Row[] = [];
          for (let i = rows.length - 1; i >= 0; i--) {
            if (pred(rows[i])) {
              deleted.push(rows[i]);
              rows.splice(i, 1);
            }
          }
          const p = Promise.resolve(deleted);
          return Object.assign(p, {
            returning() {
              return Promise.resolve(deleted);
            },
          });
        },
      };
    },
  };

  return db as unknown as StorageDb;
}

export async function getStorageDb(_config?: StorageDbConfig): Promise<StorageDb> {
  if (_overrideDb) return _overrideDb;
  if (_useMemoryDb) {
    _overrideDb = createMemoryStorageDb();
    return _overrideDb;
  }
  // Do not cache: the Hyperdrive pg pool is bound to the request I/O context.
  const appDb = await getDb();
  return appDb as unknown as StorageDb;
}

export function resetStorageDb(): void {
  _useMemoryDb = true;
  memoryStore.tenants.length = 0;
  memoryStore.projects.length = 0;
  memoryStore.apiKeys.length = 0;
  memoryStore.usageDaily.length = 0;
  memoryStore.usageEvents.length = 0;
  memoryStore.auditLog.length = 0;
  _overrideDb = createMemoryStorageDb();
}
