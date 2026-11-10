import { getDb } from "@/lib/db";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * The storage control-plane uses the same Neon PostgreSQL connection as the
 * rest of the app. Tables are prefixed with `storage_` to avoid conflicts.
 *
 * We use the full app database type (which includes storage schema tables)
 * rather than creating a separate libsql connection.
 */
export type StorageDb = NeonHttpDatabase<typeof schema>;

let cachedDb: StorageDb | undefined;

export interface StorageDbConfig {
  /** No-op: kept for API compatibility. All config is via DATABASE_URL env var. */
  url?: string;
  authToken?: string;
}

/**
 * Returns a cached singleton of the storage database (Neon PostgreSQL).
 *
 * Tables are created via Drizzle migrations (`drizzle/`) — no runtime DDL is needed.
 */
export async function getStorageDb(_config?: StorageDbConfig): Promise<StorageDb> {
  if (cachedDb) return cachedDb;

  // Reuse the main app DB connection; it already has the storage tables in its schema
  const appDb = await getDb();
  // Cast — NeonHttpDatabase is structurally compatible; schema types are what matter
  cachedDb = appDb as unknown as StorageDb;
  return cachedDb;
}

/**
 * Reset cached DB (primarily used for unit testing).
 */
export function resetStorageDb(): void {
  cachedDb = undefined;
}
