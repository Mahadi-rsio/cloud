import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type StorageDb = LibSQLDatabase<typeof schema>;

let cachedClient: Client | undefined;
let cachedDb: StorageDb | undefined;

/**
 * SQL DDL to initialize the storage control-plane schema automatically.
 */
export const STORAGE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'trial',
  plan TEXT NOT NULL DEFAULT 'free',
  storage_limit_bytes INTEGER NOT NULL DEFAULT 10737418240,
  bandwidth_limit_bytes INTEGER NOT NULL DEFAULT 53687091200,
  egress_rate_limit_mbps INTEGER NOT NULL DEFAULT 100,
  trial_ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT 'storage:read,storage:write',
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT,
  date TEXT NOT NULL,
  storage_bytes_avg INTEGER NOT NULL DEFAULT 0,
  egress_bytes INTEGER NOT NULL DEFAULT 0,
  ingress_bytes INTEGER NOT NULL DEFAULT 0,
  read_ops INTEGER NOT NULL DEFAULT 0,
  write_ops INTEGER NOT NULL DEFAULT 0,
  delete_ops INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id TEXT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  ops INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);
CREATE INDEX IF NOT EXISTS tenants_created_idx ON tenants(created_at);
CREATE INDEX IF NOT EXISTS projects_tenant_idx ON projects(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_tenant_name_idx ON projects(tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS api_keys_tenant_revoked_idx ON api_keys(tenant_id, revoked_at);
CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_tenant_proj_date_idx ON usage_daily(tenant_id, project_id, date);
CREATE INDEX IF NOT EXISTS usage_daily_tenant_date_idx ON usage_daily(tenant_id, date);
CREATE INDEX IF NOT EXISTS usage_events_tenant_time_idx ON usage_events(tenant_id, timestamp);
CREATE INDEX IF NOT EXISTS usage_events_tenant_type_idx ON usage_events(tenant_id, event_type);
CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx ON audit_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON audit_log(resource_type, resource_id);
`;

/**
 * Initializes the storage database schema.
 */
export async function initStorageDatabase(client: Client): Promise<void> {
  const statements = STORAGE_SCHEMA_DDL.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await client.execute(statement);
  }
}

export interface StorageDbConfig {
  url?: string;
  authToken?: string;
}

/**
 * Creates a new libSQL storage database connection.
 */
export function createStorageDb(config: StorageDbConfig = {}): {
  client: Client;
  db: StorageDb;
} {
  const url = config.url || process.env.STORAGE_DATABASE_URL || ":memory:";
  const authToken = config.authToken || process.env.STORAGE_DATABASE_AUTH_TOKEN;

  const client = createClient({
    url,
    authToken,
  });

  const db = drizzle(client, { schema });
  return { client, db };
}

/**
 * Returns a cached singleton of the storage database, initializing schema if needed.
 */
export async function getStorageDb(config?: StorageDbConfig): Promise<StorageDb> {
  if (cachedDb) return cachedDb;

  const { client, db } = createStorageDb(config);
  await initStorageDatabase(client);

  cachedClient = client;
  cachedDb = db;
  return cachedDb;
}

/**
 * Reset cached DB (primarily used for unit testing with fresh in-memory DB).
 */
export function resetStorageDb(): void {
  if (cachedClient) {
    try {
      cachedClient.close();
    } catch {
      // ignore
    }
  }
  cachedClient = undefined;
  cachedDb = undefined;
}
