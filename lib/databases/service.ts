import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { databases } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { CreateDatabaseInput } from "@/lib/validators/database";

const DEFAULT_BASE_DOMAIN = "cloudisy.top";
const DEFAULT_ADMIN_URL = "https://libsql-database-service.fly.dev:8443";
const DEFAULT_ADMIN_KEY = "f3d2f3ad3ef0f5460b845b9ec0eaea2dd3ccf42f4f891f36dcce19caf1686be5";

export interface DatabaseRecord {
  id: string;
  userId: string;
  name: string;
  namespace: string;
  region: string;
  status: string;
  primaryHost: string;
  httpUrl: string;
  libsqlUrl: string;
  defaultToken: string;
  createdAt: Date;
  updatedAt: Date;
  stats?: DatabaseStats | null;
}

export interface DatabaseStats {
  rowsReadCount?: number;
  rowsWrittenCount?: number;
  storageBytesUsed?: number;
  queryCount?: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { publicKey: pubPem, privateKey: privPem };
}

export function createToken(
  privateKeyPem: string,
  namespace: string,
  options: { scope?: "rw" | "ro"; expiresInSeconds?: number | null } = {},
): string {
  const scope = options.scope || "rw";
  const header = { alg: "EdDSA", typ: "JWT" };
  const payload: { a: string; ns: string; iat: number; exp?: number } = {
    a: scope,
    ns: namespace,
    iat: Math.floor(Date.now() / 1000),
  };
  if (options.expiresInSeconds) {
    payload.exp = payload.iat + options.expiresInSeconds;
  }

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .sign(null, Buffer.from(message), privateKeyPem)
    .toString("base64url");
  return `${message}.${signature}`;
}

export function generateNamespace(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);

  if (!slug) slug = "db";
  if (!/^[a-z]/.test(slug)) {
    slug = `db_${slug}`;
  }
  const rand = crypto.randomBytes(4).toString("hex");
  return `${slug}_${rand}`;
}

async function getAdminConfig() {
  const env = await getEnv();
  const adminUrl = env.LIBSQL_ADMIN_URL || DEFAULT_ADMIN_URL;
  const adminKey = env.LIBSQL_ADMIN_AUTH_KEY || DEFAULT_ADMIN_KEY;
  const baseDomain = env.LIBSQL_BASE_DOMAIN || DEFAULT_BASE_DOMAIN;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (adminKey) {
    headers["Authorization"] = `Basic ${adminKey.trim()}`;
  }

  return { adminUrl, adminKey, baseDomain, headers };
}

export async function createSqldNamespace(namespace: string, publicKeyPem: string): Promise<void> {
  const { adminUrl, headers } = await getAdminConfig();

  const res = await fetch(`${adminUrl}/v1/namespaces/${namespace}/create`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jwt_key: publicKeyPem,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 400 && errorText.includes("already exists")) {
      const cfgRes = await fetch(`${adminUrl}/v1/namespaces/${namespace}/config`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jwt_key: publicKeyPem,
          block_reads: false,
          block_writes: false,
          durability_mode: "relaxed",
        }),
      });
      if (!cfgRes.ok) {
        throw new HttpError(
          "PROVIDER_ERROR",
          `Failed to update existing namespace config in sqld: ${await cfgRes.text()}`,
          502,
        );
      }
      return;
    }
    throw new HttpError(
      "PROVIDER_ERROR",
      `Failed to create namespace in sqld: ${errorText} (HTTP ${res.status})`,
      502,
    );
  }
}

export async function deleteSqldNamespace(namespace: string): Promise<void> {
  const { adminUrl, headers } = await getAdminConfig();

  const res = await fetch(`${adminUrl}/v1/namespaces/${namespace}`, {
    method: "DELETE",
    headers,
  });

  if (!res.ok && res.status !== 404) {
    const errorText = await res.text();
    throw new HttpError(
      "PROVIDER_ERROR",
      `Failed to delete namespace in sqld: ${errorText} (HTTP ${res.status})`,
      502,
    );
  }
}

export async function getSqldNamespaceStats(namespace: string): Promise<DatabaseStats | null> {
  try {
    const { adminUrl, headers } = await getAdminConfig();
    const res = await fetch(`${adminUrl}/v1/namespaces/${namespace}/stats`, {
      method: "GET",
      headers,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      rows_read_count?: number;
      rows_written_count?: number;
      storage_bytes_used?: number;
      query_count?: number;
    };
    return {
      rowsReadCount: data.rows_read_count ?? 0,
      rowsWrittenCount: data.rows_written_count ?? 0,
      storageBytesUsed: data.storage_bytes_used ?? 0,
      queryCount: data.query_count ?? 0,
    };
  } catch {
    return null;
  }
}

export class DatabaseService {
  async list(userId: string): Promise<DatabaseRecord[]> {
    const db = await getDb();
    const records = await db
      .select()
      .from(databases)
      .where(and(eq(databases.userId, userId), isNull(databases.deletedAt)))
      .orderBy(desc(databases.createdAt));

    return await Promise.all(
      records.map(async (r) => {
        const stats = await getSqldNamespaceStats(r.namespace);
        return {
          id: r.id,
          userId: r.userId,
          name: r.name,
          namespace: r.namespace,
          region: r.region,
          status: r.status,
          primaryHost: r.primaryHost,
          httpUrl: r.httpUrl,
          libsqlUrl: r.libsqlUrl,
          defaultToken: r.defaultToken,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          stats,
        };
      }),
    );
  }

  async get(id: string, userId: string): Promise<DatabaseRecord> {
    const db = await getDb();
    const [record] = await db
      .select()
      .from(databases)
      .where(
        and(
          eq(databases.id, id),
          eq(databases.userId, userId),
          isNull(databases.deletedAt),
        ),
      );

    if (!record) {
      throw new HttpError("NOT_FOUND", "Database not found.", 404);
    }

    const stats = await getSqldNamespaceStats(record.namespace);

    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      namespace: record.namespace,
      region: record.region,
      status: record.status,
      primaryHost: record.primaryHost,
      httpUrl: record.httpUrl,
      libsqlUrl: record.libsqlUrl,
      defaultToken: record.defaultToken,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      stats,
    };
  }

  async create(userId: string, input: CreateDatabaseInput): Promise<DatabaseRecord> {
    const db = await getDb();
    const { baseDomain } = await getAdminConfig();

    const namespace = generateNamespace(input.name);
    const region = input.region || "iad";

    // 1. Generate Ed25519 keypair for cryptographic JWT authentication
    const keys = generateKeypair();

    // 2. Register namespace with sqld Admin API
    await createSqldNamespace(namespace, keys.publicKey);

    // 3. Mint default Read-Write token
    const token = createToken(keys.privateKey, namespace, { scope: "rw" });

    // Host & URLs format: {namespace}_cdb.cloudisy.top
    const primaryHost = `${namespace}_cdb.${baseDomain}`;
    const httpUrl = `https://${primaryHost}`;
    const libsqlUrl = `libsql://${primaryHost}`;

    // 4. Save to Postgres control plane
    const [record] = await db
      .insert(databases)
      .values({
        userId,
        name: input.name,
        namespace,
        region,
        status: "ready",
        primaryHost,
        httpUrl,
        libsqlUrl,
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        defaultToken: token,
      })
      .returning();

    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      namespace: record.namespace,
      region: record.region,
      status: record.status,
      primaryHost: record.primaryHost,
      httpUrl: record.httpUrl,
      libsqlUrl: record.libsqlUrl,
      defaultToken: record.defaultToken,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async delete(id: string, userId: string): Promise<{ success: boolean; id: string; namespace: string }> {
    const db = await getDb();
    const [record] = await db
      .select()
      .from(databases)
      .where(
        and(
          eq(databases.id, id),
          eq(databases.userId, userId),
          isNull(databases.deletedAt),
        ),
      );

    if (!record) {
      throw new HttpError("NOT_FOUND", "Database not found.", 404);
    }

    // 1. Delete namespace from sqld
    try {
      await deleteSqldNamespace(record.namespace);
    } catch (err) {
      console.error(`Failed to delete sqld namespace ${record.namespace}:`, err);
    }

    // 2. Delete database record in Postgres
    await db.delete(databases).where(eq(databases.id, id));

    return { success: true, id, namespace: record.namespace };
  }
}

export const databaseService = new DatabaseService();
