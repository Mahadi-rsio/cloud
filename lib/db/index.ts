import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool } from "pg";
import * as authSchema from "./schema";
import * as productSchema from "./product-schema";
import * as storageSchema from "@/lib/storage/schema";
import { getEnv } from "@/lib/env";

const schema = { ...authSchema, ...productSchema, ...storageSchema };

export type AppDb = NodePgDatabase<typeof schema>;

let cachedDb: AppDb | undefined;
let cachedPool: Pool | undefined;
let cachedSourceKey: string | undefined;

async function resolveHyperdriveConnectionString(): Promise<string | null> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return null;
  }
  try {
    const { env } = await import("cloudflare:workers");
    const hd = (env as unknown as Record<string, unknown>)?.HYPERDRIVE as
      | { connectionString?: string }
      | undefined;
    if (hd && typeof hd.connectionString === "string" && hd.connectionString.trim()) {
      return hd.connectionString.trim();
    }
  } catch {
    // Not running inside Cloudflare Workers
  }
  return null;
}

const dbScope = new AsyncLocalStorage<{ db?: AppDb }>();

/** Run fn with a request-scoped DB client shared by all getDb() calls inside it. */
export function withDbScope<T>(fn: () => T): T {
  return dbScope.run({}, fn);
}

function createPgDb(connectionString: string, max = 5): { db: AppDb; pool: Pool } {
  const pool = new Pool({
    connectionString,
    // Keep pool small; Hyperdrive manages the upstream connection pool to Neon.
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on("error", (err) => {
    console.error("[db] Unexpected PostgreSQL pool error:", err.message);
  });

  return {
    db: drizzlePg(pool, { schema }),
    pool,
  };
}

function createNeonHttpDb(url: string): AppDb {
  const cleanUrl = url.replace(/^["']|["']$/g, "").trim();
  return drizzleNeon(neon(cleanUrl), { schema }) as unknown as AppDb;
}

/**
 * Returns the Drizzle database client.
 *
 * - In Cloudflare Workers production with Hyperdrive bound: uses `pg.Pool` +
 *   `drizzle-orm/node-postgres` over `env.HYPERDRIVE.connectionString` (TCP).
 * - In local dev, migrations, and testing without Hyperdrive: uses direct `DATABASE_URL`
 *   via `@neondatabase/serverless` HTTP driver (or `pg` if `USE_PG_POOL=true`).
 */
export async function getDb(): Promise<AppDb> {
  const hyperdriveUrl = await resolveHyperdriveConnectionString();
  if (hyperdriveUrl) {
    // In Cloudflare Workers, pg.Pool TCP sockets are bound to the active request's
    // I/O context and must not be reused across requests in module scope.
    // Hyperdrive manages the persistent upstream connection pool to Neon.
    // Share ONE pool per request scope (see withDbScope) so a request never opens more
    // than Workers' simultaneous-connection limit (6), which would otherwise hang.
    const scope = dbScope.getStore();
    if (scope) {
      if (!scope.db) {
        scope.db = createPgDb(hyperdriveUrl, 3).db;
      }
      return scope.db;
    }
    return createPgDb(hyperdriveUrl, 3).db;
  }

  const env = await getEnv();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  const sourceKey = `direct:${env.DATABASE_URL}`;
  if (cachedDb && cachedSourceKey === sourceKey) {
    return cachedDb;
  }

  if (process.env.USE_PG_POOL === "true") {
    const { db, pool } = createPgDb(env.DATABASE_URL);
    cachedDb = db;
    cachedPool = pool;
    cachedSourceKey = sourceKey;
    return cachedDb;
  }

  cachedDb = createNeonHttpDb(env.DATABASE_URL);
  cachedSourceKey = sourceKey;
  return cachedDb;
}

export async function closeDbPool(): Promise<void> {
  if (cachedPool) {
    await cachedPool.end().catch(() => {});
    cachedPool = undefined;
  }
  cachedDb = undefined;
  cachedSourceKey = undefined;
}
