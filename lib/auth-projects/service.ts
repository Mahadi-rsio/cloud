import crypto from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { authProjects, databases } from "@/lib/db/product-schema";
import {
  createSqldNamespace,
  createToken,
  deleteSqldNamespace,
  generateKeypair,
  generateNamespace,
  getAdminConfig,
  getSqldNamespaceStats,
  type DatabaseStats,
} from "@/lib/databases/service";
import { HttpError } from "@/lib/http";
import type { CreateAuthProjectInput } from "@/lib/validators/auth-project";
import { applyAuthSchema } from "./schema-runner";

export interface AuthProjectRecord {
  id: string;
  userId: string;
  name: string;
  namespace: string;
  status: string;
  primaryHost: string;
  httpUrl: string;
  libsqlUrl: string;
  publishableKey: string;
  linkedDatabaseId: string | null;
  createdAt: Date;
  updatedAt: Date;
  stats?: DatabaseStats | null;
}

export interface AuthProjectRuntimeConfig {
  id: string;
  namespace: string;
  httpUrl: string;
  defaultToken: string;
  authSecret: string;
  publishableKey: string;
  status: string;
}

type AuthProjectRow = typeof authProjects.$inferSelect;

function toRecord(row: AuthProjectRow): AuthProjectRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    namespace: row.namespace,
    status: row.status,
    primaryHost: row.primaryHost,
    httpUrl: row.httpUrl,
    libsqlUrl: row.libsqlUrl,
    publishableKey: row.publishableKey,
    linkedDatabaseId: row.linkedDatabaseId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AuthProjectService {
  async list(userId: string): Promise<AuthProjectRecord[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(authProjects)
      .where(and(eq(authProjects.userId, userId), isNull(authProjects.deletedAt)))
      .orderBy(desc(authProjects.createdAt));

    return rows.map(toRecord);
  }

  private async find(id: string, userId: string): Promise<AuthProjectRow> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(authProjects)
      .where(
        and(
          eq(authProjects.id, id),
          eq(authProjects.userId, userId),
          isNull(authProjects.deletedAt),
        ),
      );

    if (!row) {
      throw new HttpError("NOT_FOUND", "Auth project not found.", 404);
    }

    return row;
  }

  async get(id: string, userId: string): Promise<AuthProjectRecord> {
    const row = await this.find(id, userId);
    const stats = await getSqldNamespaceStats(row.namespace);
    return { ...toRecord(row), stats };
  }

  async getByPublishableKey(publishableKey: string): Promise<AuthProjectRuntimeConfig> {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(authProjects)
      .where(
        and(
          eq(authProjects.publishableKey, publishableKey),
          eq(authProjects.status, "ready"),
          isNull(authProjects.deletedAt),
        ),
      );

    if (!row) {
      throw new HttpError("NOT_FOUND", "Auth project not found.", 404);
    }

    return {
      id: row.id,
      namespace: row.namespace,
      httpUrl: row.httpUrl,
      defaultToken: row.defaultToken,
      authSecret: row.authSecret,
      publishableKey: row.publishableKey,
      status: row.status,
    };
  }

  async create(userId: string, input: CreateAuthProjectInput): Promise<AuthProjectRecord> {
    const db = await getDb();
    const { baseDomain } = await getAdminConfig();

    const namespace = generateNamespace(input.name);
    const keys = generateKeypair();
    await createSqldNamespace(namespace, keys.publicKey);

    const defaultToken = createToken(keys.privateKey, namespace, { scope: "rw" });
    const primaryHost = `${namespace}.${baseDomain}`;
    const httpUrl = `https://${primaryHost}`;
    const libsqlUrl = `libsql://${primaryHost}`;
    const authSecret = crypto.randomBytes(32).toString("hex");
    const publishableKey = `pk_live_${crypto.randomBytes(20).toString("hex")}`;

    let linkedDatabaseId: string | null = null;

    try {
      await applyAuthSchema(namespace, defaultToken);

      const [linkedDatabase] = await db
        .insert(databases)
        .values({
          userId,
          name: `${input.name} (auth)`,
          namespace,
          status: "ready",
          source: "auth",
          primaryHost,
          httpUrl,
          libsqlUrl,
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          defaultToken,
        })
        .returning({ id: databases.id });

      linkedDatabaseId = linkedDatabase.id;

      const [record] = await db
        .insert(authProjects)
        .values({
          userId,
          name: input.name,
          namespace,
          status: "ready",
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          defaultToken,
          primaryHost,
          httpUrl,
          libsqlUrl,
          publishableKey,
          authSecret,
          linkedDatabaseId: linkedDatabase.id,
        })
        .returning();

      return toRecord(record);
    } catch (error) {
      try {
        await deleteSqldNamespace(namespace);
      } catch (cleanupError) {
        console.error(`Failed to clean up sqld namespace ${namespace}:`, cleanupError);
      }

      if (linkedDatabaseId) {
        try {
          await db.delete(databases).where(eq(databases.id, linkedDatabaseId));
        } catch (cleanupError) {
          console.error(`Failed to clean up databases row ${linkedDatabaseId}:`, cleanupError);
        }
      }

      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new HttpError(
        "PROVIDER_ERROR",
        `Failed to provision auth project: ${message}`,
        502,
      );
    }
  }

  async delete(
    id: string,
    userId: string,
  ): Promise<{ success: boolean; id: string; namespace: string }> {
    const db = await getDb();
    const record = await this.find(id, userId);

    try {
      await deleteSqldNamespace(record.namespace);
    } catch (error) {
      console.error(`Failed to delete sqld namespace ${record.namespace}:`, error);
    }

    const now = new Date();
    await db
      .update(authProjects)
      .set({ status: "deleted", deletedAt: now, updatedAt: now })
      .where(eq(authProjects.id, id));

    if (record.linkedDatabaseId) {
      await db
        .update(databases)
        .set({ status: "deleted", deletedAt: now, updatedAt: now })
        .where(eq(databases.id, record.linkedDatabaseId));
    }

    return { success: true, id, namespace: record.namespace };
  }
}

export const authProjectService = new AuthProjectService();
