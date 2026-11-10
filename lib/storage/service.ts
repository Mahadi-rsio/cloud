import { and, desc, eq, gte, lte } from "drizzle-orm";
import { HttpError } from "@/lib/http";
import { generateApiKey, hashApiKey, hasScope, type ApiKeyEnvironment, type StorageScope } from "./auth";
import { getStorageDb, type StorageDb } from "./db";
import {
  formatObjectKey,
  generateApiKeyId,
  generateAuditLogId,
  generateProjectId,
  generateTenantId,
  generateUsageDailyId,
  generateUsageEventId,
  validatePath,
} from "./keys";
import {
  calculateTrialEndDate,
  canPerformStorageOperation,
  canTransitionStatus,
  isTrialExpired,
  type StorageOperation,
} from "./lifecycle";
import { getStorageBucket, type PutObjectOptions, type StorageBucket } from "./r2";
import {
  apiKeys,
  auditLog,
  projects,
  tenants,
  usageDaily,
  usageEvents,
  type ApiKey,
  type AuditLogEntry,
  type Project,
  type Tenant,
  type TenantPlan,
  type TenantStatus,
  type UsageDaily,
} from "./schema";
import {
  createApiKeySchema,
  createTenantSchema,
  type CreateApiKeyInput,
  type CreateProjectInput,
  type CreateTenantInput,
  type ListAuditLogsQuery,
  type ListUsageDailyQuery,
  type UpdateTenantInput,
} from "./validators";

export class StorageService {
  private dbPromise: Promise<StorageDb>;
  private bucketPromise: Promise<StorageBucket>;

  constructor(
    dbPromise = getStorageDb(),
    bucketPromise = getStorageBucket(),
  ) {
    this.dbPromise = dbPromise;
    this.bucketPromise = bucketPromise;
  }

  private async db(): Promise<StorageDb> {
    return await this.dbPromise;
  }

  private async bucket(): Promise<StorageBucket> {
    return await this.bucketPromise;
  }

  /* =========================================================================
   * Tenants
   * ========================================================================= */

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const db = await this.db();
    const parsed = createTenantSchema.parse(input);
    const id = parsed.id ?? generateTenantId();
    const now = new Date().toISOString();
    const trialEndsAt = calculateTrialEndDate(parsed.trialDays ?? 7);

    const values = {
      id,
      name: parsed.name,
      status: "trial" as TenantStatus,
      plan: parsed.plan as TenantPlan,
      storageLimitBytes: parsed.storageLimitBytes ?? 10 * 1024 * 1024 * 1024,
      bandwidthLimitBytes: parsed.bandwidthLimitBytes ?? 50 * 1024 * 1024 * 1024,
      egressRateLimitMbps: parsed.egressRateLimitMbps ?? 100,
      trialEndsAt,
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(tenants).values(values);

    await this.recordAudit({
      tenantId: id,
      actorType: "system",
      actorId: "system",
      action: "tenant.create",
      resourceType: "tenant",
      resourceId: id,
      metadata: JSON.stringify({ name: input.name, plan: input.plan }),
    });

    const [created] = await db.select().from(tenants).where(eq(tenants.id, id));
    return created!;
  }

  async getTenant(id: string): Promise<Tenant | null> {
    const db = await this.db();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    return tenant ?? null;
  }

  async updateTenant(id: string, input: UpdateTenantInput): Promise<Tenant> {
    const db = await this.db();
    const current = await this.getTenant(id);
    if (!current) {
      throw new HttpError("NOT_FOUND", "Tenant not found", 404);
    }

    if (input.status && !canTransitionStatus(current.status as TenantStatus, input.status)) {
      throw new HttpError(
        "CONFLICT",
        `Cannot transition tenant from ${current.status} to ${input.status}`,
        400,
      );
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof tenants.$inferInsert> = {
      updatedAt: now,
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.status !== undefined) updates.status = input.status;
    if (input.plan !== undefined) updates.plan = input.plan;
    if (input.storageLimitBytes !== undefined) updates.storageLimitBytes = input.storageLimitBytes;
    if (input.bandwidthLimitBytes !== undefined) updates.bandwidthLimitBytes = input.bandwidthLimitBytes;
    if (input.egressRateLimitMbps !== undefined) updates.egressRateLimitMbps = input.egressRateLimitMbps;
    if (input.trialEndsAt !== undefined) updates.trialEndsAt = input.trialEndsAt;

    await db.update(tenants).set(updates).where(eq(tenants.id, id));

    await this.recordAudit({
      tenantId: id,
      actorType: "system",
      actorId: "system",
      action: "tenant.update",
      resourceType: "tenant",
      resourceId: id,
      metadata: JSON.stringify(updates),
    });

    const [updated] = await db.select().from(tenants).where(eq(tenants.id, id));
    return updated!;
  }

  async deleteTenant(id: string): Promise<void> {
    const db = await this.db();
    const tenant = await this.getTenant(id);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found", 404);
    }

    // Mark as deleted
    await db.update(tenants).set({ status: "deleted", updatedAt: new Date().toISOString() }).where(eq(tenants.id, id));

    // Cleanup tenant namespaces from R2
    const namespaces = await this.listNamespaces(id);
    for (const ns of namespaces) {
      await this.deleteNamespace(id, ns.id);
    }

    await db.delete(tenants).where(eq(tenants.id, id));
  }

  /* =========================================================================
   * Storage Namespaces (Projects)
   * ========================================================================= */

  async createNamespace(tenantId: string, name: string): Promise<Project> {
    const db = await this.db();
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found", 404);
    }

    const check = canPerformStorageOperation(tenant.status as TenantStatus, tenant.trialEndsAt, "write");
    if (!check.allowed) {
      throw new HttpError("FORBIDDEN", check.reason, check.status);
    }

    const existing = await db
      .select()
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.name, name)));

    if (existing.length > 0) {
      throw new HttpError("CONFLICT", `Namespace '${name}' already exists.`, 409);
    }

    const id = generateProjectId();
    const now = new Date().toISOString();

    await db.insert(projects).values({
      id,
      tenantId,
      name,
      createdAt: now,
      updatedAt: now,
    });

    await this.recordAudit({
      tenantId,
      actorType: "system",
      actorId: "system",
      action: "namespace.create",
      resourceType: "namespace",
      resourceId: id,
      metadata: JSON.stringify({ name }),
    });

    const [created] = await db.select().from(projects).where(eq(projects.id, id));
    return created!;
  }

  async listNamespaces(tenantId: string): Promise<Project[]> {
    const db = await this.db();
    return await db.select().from(projects).where(eq(projects.tenantId, tenantId));
  }

  async getNamespace(tenantId: string, nameOrId: string): Promise<Project | null> {
    const db = await this.db();
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.tenantId, tenantId),
          nameOrId.startsWith("p_") ? eq(projects.id, nameOrId) : eq(projects.name, nameOrId),
        ),
      );
    return project ?? null;
  }

  async deleteNamespace(tenantId: string, nameOrId: string): Promise<void> {
    const db = await this.db();
    const project = await this.getNamespace(tenantId, nameOrId);
    if (!project) {
      throw new HttpError("NOT_FOUND", "Namespace not found", 404);
    }

    // Delete all objects from R2 under this namespace
    const bucket = await this.bucket();
    const prefix = `t_${tenantId.replace(/^t_/, "")}/${project.name}/`;
    const listed = await bucket.list({ prefix, limit: 1000 });
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
    }

    await db.delete(projects).where(eq(projects.id, project.id));

    await this.recordAudit({
      tenantId,
      actorType: "system",
      actorId: "system",
      action: "namespace.delete",
      resourceType: "namespace",
      resourceId: project.id,
      metadata: JSON.stringify({ name: project.name }),
    });
  }

  /* =========================================================================
   * API Keys
   * ========================================================================= */

  async createApiKey(
    input: CreateApiKeyInput,
  ): Promise<{ apiKey: ApiKey; secretKey: string }> {
    const validated = createApiKeySchema.parse(input);
    const db = await this.db();
    const tenant = await this.getTenant(validated.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant not found", 404);
    }

    let projectId: string | null = null;
    if (validated.projectId) {
      const project = await this.getNamespace(validated.tenantId, validated.projectId);
      if (!project) {
        throw new HttpError("NOT_FOUND", `Project '${validated.projectId}' not found`, 404);
      }
      projectId = project.id;
    }

    const { key, prefix, keyHash } = await generateApiKey(validated.environment as ApiKeyEnvironment);
    const id = generateApiKeyId();
    const now = new Date().toISOString();

    const scopesStr = Array.isArray(validated.scopes) ? validated.scopes.join(",") : validated.scopes;
    const expiresAt = validated.expiresInDays
      ? new Date(Date.now() + validated.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    await db.insert(apiKeys).values({
      id,
      tenantId: validated.tenantId,
      projectId,
      name: validated.name,
      keyHash,
      prefix,
      scopes: scopesStr,
      expiresAt,
      createdAt: now,
    });

    await this.recordAudit({
      tenantId: validated.tenantId,
      actorType: "system",
      actorId: "system",
      action: "api_key.create",
      resourceType: "api_key",
      resourceId: id,
      metadata: JSON.stringify({ name: validated.name, prefix, scopes: scopesStr }),
    });

    const [created] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
    return { apiKey: created!, secretKey: key };
  }

  async listApiKeys(tenantId: string): Promise<Omit<ApiKey, "keyHash">[]> {
    const db = await this.db();
    const keys = await db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId));
    // Never expose keyHash in responses
    return keys.map(({ keyHash: _, ...rest }) => rest);
  }

  async revokeApiKey(tenantId: string, keyId: string): Promise<void> {
    const db = await this.db();
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId)));

    if (!key) {
      throw new HttpError("NOT_FOUND", "API key not found", 404);
    }

    if (key.revokedAt) {
      return; // Already revoked
    }

    const now = new Date().toISOString();
    await db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, keyId));

    await this.recordAudit({
      tenantId,
      actorType: "system",
      actorId: "system",
      action: "api_key.revoke",
      resourceType: "api_key",
      resourceId: keyId,
      metadata: JSON.stringify({ prefix: key.prefix }),
    });
  }

  /**
   * Authenticate a raw API key token (e.g. sk_live_...), checking hash, revocation, expiration, and tenant status.
   */
  async authenticateApiKey(
    rawKey: string,
    requiredScope: StorageScope = "storage:read",
  ): Promise<{ tenant: Tenant; apiKey: ApiKey; project: Project | null }> {
    if (!rawKey || typeof rawKey !== "string") {
      throw new HttpError("UNAUTHENTICATED", "Missing API key", 401);
    }

    const keyHash = await hashApiKey(rawKey.trim());
    const db = await this.db();

    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
    if (!key) {
      throw new HttpError("UNAUTHENTICATED", "Invalid API key", 401);
    }

    if (key.revokedAt) {
      throw new HttpError("FORBIDDEN", "This API key has been revoked", 403);
    }

    if (key.expiresAt && new Date(key.expiresAt).getTime() < Date.now()) {
      throw new HttpError("FORBIDDEN", "This API key has expired", 403);
    }

    if (!hasScope(key.scopes, requiredScope)) {
      throw new HttpError("FORBIDDEN", `API key lacks required scope '${requiredScope}'`, 403);
    }

    const tenant = await this.getTenant(key.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant associated with API key not found", 404);
    }

    let project: Project | null = null;
    if (key.projectId) {
      project = await this.getNamespace(key.tenantId, key.projectId);
    }

    // Touch lastUsedAt asynchronously
    db.update(apiKeys).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiKeys.id, key.id)).catch(() => {});

    return { tenant, apiKey: key, project };
  }

  /* =========================================================================
   * Object Storage Operations (Upload, Download, Delete, List, Head)
   * ========================================================================= */

  private async assertOperationAllowed(
    tenant: Tenant,
    operation: StorageOperation,
  ): Promise<void> {
    const check = canPerformStorageOperation(tenant.status as TenantStatus, tenant.trialEndsAt, operation);
    if (!check.allowed) {
      throw new HttpError("FORBIDDEN", check.reason, check.status);
    }
  }

  async uploadFile(
    tenant: Tenant,
    namespaceName: string,
    filePath: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string | Blob,
    options?: PutObjectOptions,
  ) {
    await this.assertOperationAllowed(tenant, "write");

    const validated = validatePath(filePath);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    const namespace = await this.getNamespace(tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    const stored = await bucket.put(r2Key, body, options);

    // Record usage
    await this.recordUsage(tenant.id, namespace.id, "write", stored.size, 1);

    return {
      namespace: namespace.name,
      path: validated.normalized,
      r2Key,
      size: stored.size,
      etag: stored.etag,
      httpMetadata: stored.httpMetadata,
      uploaded: stored.uploaded,
    };
  }

  async downloadFile(
    tenant: Tenant,
    namespaceName: string,
    filePath: string,
    options?: { range?: { offset?: number; length?: number } },
  ) {
    await this.assertOperationAllowed(tenant, "read");

    const validated = validatePath(filePath);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    const namespace = await this.getNamespace(tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    const object = await bucket.get(r2Key, options);
    if (!object) {
      throw new HttpError("NOT_FOUND", `File '${filePath}' not found`, 404);
    }

    // Record egress usage
    await this.recordUsage(tenant.id, namespace.id, "read", object.size, 1);

    return {
      namespace: namespace.name,
      path: validated.normalized,
      object,
    };
  }

  async deleteFile(tenant: Tenant, namespaceName: string, filePath: string) {
    await this.assertOperationAllowed(tenant, "delete");

    const validated = validatePath(filePath);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    const namespace = await this.getNamespace(tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    await bucket.delete(r2Key);

    await this.recordUsage(tenant.id, namespace.id, "delete", 0, 1);

    return { success: true, namespace: namespace.name, path: validated.normalized };
  }

  async listFiles(
    tenant: Tenant,
    namespaceName: string,
    options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number },
  ) {
    await this.assertOperationAllowed(tenant, "list");

    const namespace = await this.getNamespace(tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const basePrefix = `t_${tenant.id.replace(/^t_/, "")}/${namespace.name}/`;
    const userPrefix = options?.prefix ? options.prefix.replace(/^\/+/, "") : "";
    const fullPrefix = `${basePrefix}${userPrefix}`;

    const bucket = await this.bucket();
    const result = await bucket.list({
      prefix: fullPrefix,
      delimiter: options?.delimiter,
      cursor: options?.cursor,
      limit: options?.limit ?? 100,
    });

    // Strip internal prefix from returned object paths
    const formattedObjects = result.objects.map((obj) => ({
      path: obj.key.slice(basePrefix.length),
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded,
      httpMetadata: obj.httpMetadata,
    }));

    const formattedPrefixes = result.delimitedPrefixes.map((p) => p.slice(basePrefix.length));

    return {
      namespace: namespace.name,
      objects: formattedObjects,
      prefixes: formattedPrefixes,
      cursor: result.cursor,
      truncated: result.truncated,
    };
  }

  async headFile(tenant: Tenant, namespaceName: string, filePath: string) {
    await this.assertOperationAllowed(tenant, "read");

    const validated = validatePath(filePath);
    if (!validated.valid) {
      throw new HttpError("VALIDATION_ERROR", validated.error, 400);
    }

    const namespace = await this.getNamespace(tenant.id, namespaceName);
    if (!namespace) {
      throw new HttpError("NOT_FOUND", `Namespace '${namespaceName}' not found`, 404);
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    const meta = await bucket.head(r2Key);
    if (!meta) {
      throw new HttpError("NOT_FOUND", `File '${filePath}' not found`, 404);
    }

    return {
      namespace: namespace.name,
      path: validated.normalized,
      size: meta.size,
      etag: meta.etag,
      httpMetadata: meta.httpMetadata,
      uploaded: meta.uploaded,
    };
  }

  /**
   * Copies a file from one location to another within the same tenant.
   * The destination namespace may differ from the source namespace.
   */
  async copyFile(
    tenant: Tenant,
    sourceNamespace: string,
    sourcePath: string,
    destinationNamespace: string,
    destinationPath: string,
  ) {
    await this.assertOperationAllowed(tenant, "read");
    await this.assertOperationAllowed(tenant, "write");

    // Validate both paths up front
    const srcValidated = validatePath(sourcePath);
    if (!srcValidated.valid) {
      throw new HttpError("VALIDATION_ERROR", srcValidated.error, 400);
    }
    const dstValidated = validatePath(destinationPath);
    if (!dstValidated.valid) {
      throw new HttpError("VALIDATION_ERROR", dstValidated.error, 400);
    }

    // Resolve namespaces
    const srcNs = await this.getNamespace(tenant.id, sourceNamespace);
    if (!srcNs) {
      throw new HttpError("NOT_FOUND", `Source namespace '${sourceNamespace}' not found`, 404);
    }
    const dstNs = await this.getNamespace(tenant.id, destinationNamespace);
    if (!dstNs) {
      throw new HttpError("NOT_FOUND", `Destination namespace '${destinationNamespace}' not found`, 404);
    }

    const bucket = await this.bucket();

    // Download source object
    const srcKey = formatObjectKey(tenant.id, srcNs.name, srcValidated.normalized);
    const srcObject = await bucket.get(srcKey);
    if (!srcObject) {
      throw new HttpError("NOT_FOUND", `Source file '${sourcePath}' not found`, 404);
    }

    // Re-upload to destination preserving content type and custom metadata
    const dstKey = formatObjectKey(tenant.id, dstNs.name, dstValidated.normalized);
    const body = await srcObject.arrayBuffer();
    const stored = await bucket.put(dstKey, body, {
      httpMetadata: srcObject.httpMetadata,
      customMetadata: srcObject.customMetadata,
    });

    // Record usage for both the read and the write
    await this.recordUsage(tenant.id, srcNs.id, "read", srcObject.size, 1);
    await this.recordUsage(tenant.id, dstNs.id, "write", stored.size, 1);

    return {
      sourceNamespace: srcNs.name,
      sourcePath: srcValidated.normalized,
      destinationNamespace: dstNs.name,
      destinationPath: dstValidated.normalized,
      size: stored.size,
      etag: stored.etag,
    };
  }

  /* =========================================================================
   * Usage and Audit Logging
   * ========================================================================= */

  async recordUsage(
    tenantId: string,
    projectId: string | null,
    eventType: "read" | "write" | "delete" | "egress",
    bytes = 0,
    ops = 1,
  ) {
    try {
      const db = await this.db();
      const now = new Date();
      const today = now.toISOString().slice(0, 10); // YYYY-MM-DD

      // 1. Insert granular usage event
      await db.insert(usageEvents).values({
        id: generateUsageEventId(),
        tenantId,
        projectId,
        timestamp: now.toISOString(),
        eventType,
        bytes,
        ops,
      });

      // 2. Upsert daily aggregate
      const existing = await db
        .select()
        .from(usageDaily)
        .where(
          and(
            eq(usageDaily.tenantId, tenantId),
            projectId ? eq(usageDaily.projectId, projectId) : eq(usageDaily.projectId, ""),
            eq(usageDaily.date, today),
          ),
        );

      if (existing.length === 0) {
        await db.insert(usageDaily).values({
          id: generateUsageDailyId(),
          tenantId,
          projectId: projectId ?? "",
          date: today,
          egressBytes: eventType === "read" || eventType === "egress" ? bytes : 0,
          ingressBytes: eventType === "write" ? bytes : 0,
          readOps: eventType === "read" ? ops : 0,
          writeOps: eventType === "write" ? ops : 0,
          deleteOps: eventType === "delete" ? ops : 0,
          updatedAt: now.toISOString(),
        });
      } else {
        const row = existing[0]!;
        await db
          .update(usageDaily)
          .set({
            egressBytes: row.egressBytes + (eventType === "read" || eventType === "egress" ? bytes : 0),
            ingressBytes: row.ingressBytes + (eventType === "write" ? bytes : 0),
            readOps: row.readOps + (eventType === "read" ? ops : 0),
            writeOps: row.writeOps + (eventType === "write" ? ops : 0),
            deleteOps: row.deleteOps + (eventType === "delete" ? ops : 0),
            updatedAt: now.toISOString(),
          })
          .where(eq(usageDaily.id, row.id));
      }
    } catch (err) {
      console.error("[storage] failed to record usage", err);
    }
  }

  async recordAudit(entry: {
    tenantId: string;
    actorType: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      const db = await this.db();
      await db.insert(auditLog).values({
        id: generateAuditLogId(),
        tenantId: entry.tenantId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[storage] failed to record audit log", err);
    }
  }

  async getDailyUsage(query: ListUsageDailyQuery): Promise<UsageDaily[]> {
    const db = await this.db();
    const conditions = [eq(usageDaily.tenantId, query.tenantId)];

    if (query.projectId) {
      conditions.push(eq(usageDaily.projectId, query.projectId));
    }
    if (query.startDate) {
      conditions.push(gte(usageDaily.date, query.startDate));
    }
    if (query.endDate) {
      conditions.push(lte(usageDaily.date, query.endDate));
    }

    return await db
      .select()
      .from(usageDaily)
      .where(and(...conditions))
      .orderBy(desc(usageDaily.date));
  }

  async getAuditLogs(query: ListAuditLogsQuery): Promise<AuditLogEntry[]> {
    const db = await this.db();
    const conditions = [eq(auditLog.tenantId, query.tenantId)];

    if (query.resourceType) {
      conditions.push(eq(auditLog.resourceType, query.resourceType));
    }

    return await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit ?? 50);
  }
}

let globalStorageService: StorageService | undefined;

export function getStorageService(): StorageService {
  if (!globalStorageService) {
    globalStorageService = new StorageService();
  }
  return globalStorageService;
}
