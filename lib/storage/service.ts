import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { HttpError } from "@/lib/http";
import { TypedKvCache } from "@/lib/kv";
import {
  generateApiKey,
  hashApiKey,
  hasScope,
  validateStorageScopes,
  type ApiKeyEnvironment,
  type StorageScope,
} from "./auth";
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
  type StorageOperation,
} from "./lifecycle";
import { getStorageBucket, type PutObjectOptions, type StorageBucket } from "./r2";
import { getTenantMeter, type TenantUsageSnapshot } from "./quota-do";
import { invalidateApiKeyCache } from "./request-auth";
import {
  apiKeys,
  auditLog,
  projects,
  STORAGE_PLANS,
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
  type CreateTenantInput,
  type ListAuditLogsQuery,
  type ListUsageDailyQuery,
  type UpdateTenantInput,
} from "./validators";

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB default max single-upload size

/**
 * Wrap a ReadableStream in a byte-counting transform that aborts immediately if:
 *   1. `maxUploadBytes` (default 100 MB) is exceeded -> 413 PAYLOAD_TOO_LARGE
 *   2. `maxQuotaDeltaBytes` (remaining tenant storage quota) is exceeded -> 402/413 FORBIDDEN
 *   3. `declaredContentLength` is exceeded -> 413 PAYLOAD_TOO_LARGE
 */
export function createBoundedUploadStream(
  source: ReadableStream<Uint8Array>,
  limits: {
    maxUploadBytes?: number;
    maxQuotaTotalBytes?: number;
    declaredContentLength?: number | null;
  },
): {
  stream: ReadableStream<Uint8Array>;
  getBytesRead: () => number;
} {
  const maxUploadBytes = limits.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const maxQuotaTotalBytes = limits.maxQuotaTotalBytes;
  const declaredLength =
    typeof limits.declaredContentLength === "number" &&
    Number.isFinite(limits.declaredContentLength) &&
    limits.declaredContentLength >= 0
      ? limits.declaredContentLength
      : null;

  let bytesRead = 0;
  const reader = source.getReader();

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > maxUploadBytes) {
          await reader.cancel("Upload exceeds maximum object size").catch(() => {});
          throw new HttpError(
            "VALIDATION_ERROR",
            `Upload exceeds maximum size of ${Math.round(maxUploadBytes / (1024 * 1024))} MB`,
            413,
          );
        }
        if (declaredLength !== null && bytesRead > declaredLength) {
          await reader.cancel("Stream exceeded declared Content-Length").catch(() => {});
          throw new HttpError(
            "VALIDATION_ERROR",
            `Stream size (${bytesRead} bytes) exceeded declared Content-Length (${declaredLength} bytes)`,
            413,
          );
        }
        if (maxQuotaTotalBytes !== undefined && bytesRead > maxQuotaTotalBytes) {
          await reader.cancel("Storage quota exceeded during streaming upload").catch(() => {});
          throw new HttpError(
            "FORBIDDEN",
            `Storage quota exceeded during upload (${bytesRead} bytes exceeds remaining capacity of ${maxQuotaTotalBytes} bytes)`,
            402,
          );
        }
        controller.enqueue(value);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {});
    },
  });

  return {
    stream,
    getBytesRead: () => bytesRead,
  };
}

const tenantKv = new TypedKvCache("storage:tenant", "v1");
const namespaceKv = new TypedKvCache("storage:ns", "v1");

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

  async createTenant(
    input: CreateTenantInput & { allowCustomQuotas?: boolean },
  ): Promise<Tenant> {
    const db = await this.db();
    const parsed = createTenantSchema.parse(input);
    const id = parsed.id ?? generateTenantId();
    const now = new Date().toISOString();
    const trialEndsAt = calculateTrialEndDate(parsed.trialDays ?? 7);

    const planName: TenantPlan = input.allowCustomQuotas
      ? (parsed.plan as TenantPlan)
      : "free";
    const planConfig = STORAGE_PLANS[planName] ?? STORAGE_PLANS.free;

    const values = {
      id,
      name: parsed.name,
      status: "trial" as TenantStatus,
      plan: planName,
      storageLimitBytes: input.allowCustomQuotas
        ? (parsed.storageLimitBytes ?? planConfig.storageLimitBytes)
        : planConfig.storageLimitBytes,
      storageUsedBytes: 0,
      fileCount: 0,
      monthlyReadLimitOps: planConfig.monthlyReadLimitOps,
      monthlyWriteLimitOps: planConfig.monthlyWriteLimitOps,
      bandwidthLimitBytes: input.allowCustomQuotas
        ? (parsed.bandwidthLimitBytes ?? planConfig.bandwidthLimitBytes)
        : planConfig.bandwidthLimitBytes,
      egressRateLimitMbps: input.allowCustomQuotas
        ? (parsed.egressRateLimitMbps ?? planConfig.egressRateLimitMbps)
        : planConfig.egressRateLimitMbps,
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
      metadata: JSON.stringify({ name: input.name, plan: planName }),
    });

    const [created] = await db.select().from(tenants).where(eq(tenants.id, id));
    return created!;
  }

  async getTenant(id: string): Promise<Tenant | null> {
    return tenantKv.getOrLoad(
      id,
      async () => {
        const db = await this.db();
        const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
        return tenant ?? null;
      },
      { kvTtlSeconds: 60, l1TtlMs: 15_000 },
    );
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
    if (input.plan !== undefined) {
      updates.plan = input.plan;
      const planConfig = STORAGE_PLANS[input.plan as TenantPlan];
      if (planConfig) {
        if (input.storageLimitBytes === undefined) {
          updates.storageLimitBytes = planConfig.storageLimitBytes;
        }
        updates.monthlyReadLimitOps = planConfig.monthlyReadLimitOps;
        updates.monthlyWriteLimitOps = planConfig.monthlyWriteLimitOps;
      }
    }
    if (input.storageLimitBytes !== undefined) updates.storageLimitBytes = input.storageLimitBytes;
    if (input.monthlyReadLimitOps !== undefined) updates.monthlyReadLimitOps = input.monthlyReadLimitOps;
    if (input.monthlyWriteLimitOps !== undefined) updates.monthlyWriteLimitOps = input.monthlyWriteLimitOps;
    if (input.bandwidthLimitBytes !== undefined) updates.bandwidthLimitBytes = input.bandwidthLimitBytes;
    if (input.egressRateLimitMbps !== undefined) updates.egressRateLimitMbps = input.egressRateLimitMbps;
    if (input.trialEndsAt !== undefined) updates.trialEndsAt = input.trialEndsAt;

    await db.update(tenants).set(updates).where(eq(tenants.id, id));
    await tenantKv.delete(id);

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

    await db
      .update(tenants)
      .set({ status: "deleted", updatedAt: new Date().toISOString() })
      .where(eq(tenants.id, id));

    const namespaces = await this.listNamespaces(id);
    for (const ns of namespaces) {
      await this.deleteNamespace(id, ns.id);
    }

    await db.delete(tenants).where(eq(tenants.id, id));
    await tenantKv.delete(id);
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

    const check = canPerformStorageOperation(
      tenant.status as TenantStatus,
      tenant.trialEndsAt,
      "write",
    );
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
    if (created) {
      await namespaceKv.setJson(`${tenantId}:${created.id}`, created, {
        kvTtlSeconds: 120,
        l1TtlMs: 30_000,
      });
      await namespaceKv.setJson(`${tenantId}:${created.name}`, created, {
        kvTtlSeconds: 120,
        l1TtlMs: 30_000,
      });
    }
    return created!;
  }

  async listNamespaces(tenantId: string): Promise<Project[]> {
    const db = await this.db();
    return await db.select().from(projects).where(eq(projects.tenantId, tenantId));
  }

  async getNamespace(tenantId: string, nameOrId: string): Promise<Project | null> {
    return namespaceKv.getOrLoad(
      `${tenantId}:${nameOrId}`,
      async () => {
        const db = await this.db();
        const [project] = await db
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.tenantId, tenantId),
              nameOrId.startsWith("p_")
                ? eq(projects.id, nameOrId)
                : eq(projects.name, nameOrId),
            ),
          );
        return project ?? null;
      },
      { kvTtlSeconds: 120, l1TtlMs: 30_000 },
    );
  }

  async deleteNamespace(tenantId: string, nameOrId: string): Promise<void> {
    const db = await this.db();
    const project = await this.getNamespace(tenantId, nameOrId);
    if (!project) {
      throw new HttpError("NOT_FOUND", "Namespace not found", 404);
    }

    const bucket = await this.bucket();
    const meter = await getTenantMeter(tenantId);
    const prefix = `t_${tenantId.replace(/^t_/, "")}/${project.name}/`;
    const listed = await bucket.list({ prefix, limit: 1000 });
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
      await meter.deleteFile(obj.size);
    }

    await db.delete(projects).where(eq(projects.id, project.id));
    await Promise.all([
      namespaceKv.delete(`${tenantId}:${project.id}`),
      namespaceKv.delete(`${tenantId}:${project.name}`),
    ]);

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
    const parsedResult = createApiKeySchema.safeParse(input);
    if (!parsedResult.success) {
      throw new HttpError(
        "VALIDATION_ERROR",
        parsedResult.error.issues[0]?.message ?? "Invalid API key input",
        400,
      );
    }
    const validated = parsedResult.data;
    const scopeCheck = validateStorageScopes(validated.scopes);
    if (!scopeCheck.valid) {
      throw new HttpError(
        "VALIDATION_ERROR",
        scopeCheck.invalidScopes.length > 0
          ? `Unsupported permission scope(s): ${scopeCheck.invalidScopes.join(", ")}`
          : "At least one valid storage permission scope is required",
        400,
      );
    }

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

    const { key, prefix, keyHash } = await generateApiKey(
      validated.environment as ApiKeyEnvironment,
    );
    const id = generateApiKeyId();
    const now = new Date().toISOString();

    const scopesStr = scopeCheck.scopes.join(",");
    const expiresAt = validated.expiresAt
      ? validated.expiresAt
      : validated.expiresInDays
        ? new Date(
            Date.now() + validated.expiresInDays * 24 * 60 * 60 * 1000,
          ).toISOString()
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
    const { keyHash: _redacted, ...safeRecord } = created!;
    return {
      apiKey: { ...safeRecord, keyHash: "[REDACTED]" } as ApiKey,
      secretKey: key,
    };
  }

  async listApiKeys(tenantId: string): Promise<Omit<ApiKey, "keyHash">[]> {
    const db = await this.db();
    const keys = await db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId));
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

    if (!key.revokedAt) {
      const now = new Date().toISOString();
      await db.update(apiKeys).set({ revokedAt: now }).where(eq(apiKeys.id, keyId));
    }

    await invalidateApiKeyCache({ keyId: key.id, keyHash: key.keyHash });

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

    if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
      throw new HttpError("FORBIDDEN", "This API key has expired", 403);
    }

    if (!hasScope(key.scopes, requiredScope)) {
      throw new HttpError(
        "FORBIDDEN",
        `API key lacks required scope '${requiredScope}'`,
        403,
      );
    }

    const tenant = await this.getTenant(key.tenantId);
    if (!tenant) {
      throw new HttpError("NOT_FOUND", "Tenant associated with API key not found", 404);
    }

    let project: Project | null = null;
    if (key.projectId) {
      project = await this.getNamespace(key.tenantId, key.projectId);
    }

    db.update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, key.id))
      .catch(() => {});

    return { tenant, apiKey: key, project };
  }

  /* =========================================================================
   * Object Storage Operations (Upload, Download, Delete, List, Head)
   * ========================================================================= */

  private async assertOperationAllowed(
    tenant: Tenant,
    operation: StorageOperation,
  ): Promise<void> {
    const check = canPerformStorageOperation(
      tenant.status as TenantStatus,
      tenant.trialEndsAt,
      operation,
    );
    if (!check.allowed) {
      throw new HttpError("FORBIDDEN", check.reason, check.status);
    }
  }

  async uploadFile(
    tenant: Tenant,
    namespaceName: string,
    filePath: string,
    body: ReadableStream | ArrayBuffer | Uint8Array | string | Blob,
    options?: PutObjectOptions & {
      declaredContentLength?: number | null;
      maxUploadBytes?: number;
      idempotencyKey?: string;
    },
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

    const meter = await getTenantMeter(tenant.id);

    // 1. Check monthly write quota (100k on free plan)
    const writeCheck = await meter.checkOperationQuota(
      "class_a",
      tenant.monthlyWriteLimitOps,
    );
    if (!writeCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly write operation quota exceeded (${writeCheck.count}/${writeCheck.limit} ops; 100k free tier limit)`,
        402,
      );
    }

    const maxUploadBytes = options?.maxUploadBytes ?? MAX_UPLOAD_BYTES;
    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    // Check if object already exists so overwrites account for delta bytes rather than double-counting
    const existingObj = await bucket.head(r2Key);
    const existingBytes = existingObj?.size ?? 0;
    const isOverwrite = existingObj !== null;

    // 2. Determine preflight size if known
    let preflightSize = 0;
    if (typeof body === "string") preflightSize = new TextEncoder().encode(body).length;
    else if (body instanceof Uint8Array) preflightSize = body.byteLength;
    else if (body instanceof ArrayBuffer) preflightSize = body.byteLength;
    else if (typeof Blob !== "undefined" && body instanceof Blob) preflightSize = body.size;
    else if (
      typeof options?.declaredContentLength === "number" &&
      Number.isFinite(options.declaredContentLength) &&
      options.declaredContentLength > 0
    ) {
      preflightSize = options.declaredContentLength;
    }

    if (preflightSize > maxUploadBytes) {
      throw new HttpError(
        "VALIDATION_ERROR",
        `Upload exceeds maximum size of ${Math.round(maxUploadBytes / (1024 * 1024))} MB`,
        413,
      );
    }

    const idempotencyKey =
      options?.idempotencyKey ?? options?.customMetadata?.["idempotency-key"];

    // 3. Create atomic reservation before writing to R2
    const reservationRes = await meter.createReservation({
      requestedBytes: preflightSize,
      existingBytes,
      isOverwrite,
      limitBytes: tenant.storageLimitBytes,
      objectKey: r2Key,
      idempotencyKey,
    });

    if (!reservationRes.ok || !reservationRes.reservation) {
      throw new HttpError(
        "FORBIDDEN",
        `Storage quota exceeded: ${reservationRes.usedBytes} bytes currently used; limit is ${reservationRes.limitBytes} bytes (512 MB free tier limit)`,
        402,
      );
    }

    const reservationId = reservationRes.reservation.id;
    const maxAllowedTotalBytes = Math.max(
      0,
      tenant.storageLimitBytes - reservationRes.usedBytes + existingBytes,
    );

    let uploadBody: ReadableStream | ArrayBuffer | Uint8Array | string | Blob = body;
    if (body && typeof (body as ReadableStream).getReader === "function") {
      const bounded = createBoundedUploadStream(body as ReadableStream<Uint8Array>, {
        maxUploadBytes,
        maxQuotaTotalBytes: maxAllowedTotalBytes,
        declaredContentLength: options?.declaredContentLength,
      });
      uploadBody = bounded.stream;
    }

    let stored;
    try {
      if (uploadBody && typeof (uploadBody as ReadableStream).getReader === "function") {
        // R2 requires a known-length stream. Use FixedLengthStream when the length is declared,
        // otherwise buffer (the bounded stream still enforces size/quota limits while reading).
        const FixedLen = (globalThis as unknown as {
          FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array>;
        }).FixedLengthStream;
        const declared = options?.declaredContentLength;
        if (FixedLen && typeof declared === "number" && declared >= 0) {
          const fixed = new FixedLen(declared);
          const piping = (uploadBody as ReadableStream<Uint8Array>).pipeTo(fixed.writable);
          const putPromise = bucket.put(r2Key, fixed.readable, options);
          const [, putResult] = await Promise.all([piping, putPromise]);
          stored = putResult;
        } else if (FixedLen) {
          uploadBody = await new Response(uploadBody as ReadableStream).arrayBuffer();
        }
      }
      if (!stored) stored = await bucket.put(r2Key, uploadBody, options);
    } catch (err) {
      await meter.releaseReservation(reservationId);
      throw err;
    }

    // Verify final stored size against both maxUploadBytes and tenant quota
    if (stored.size > maxUploadBytes) {
      await meter.releaseReservation(reservationId);
      await bucket.delete(r2Key).catch(() => {});
      throw new HttpError(
        "VALIDATION_ERROR",
        `Upload exceeds maximum size of ${Math.round(maxUploadBytes / (1024 * 1024))} MB`,
        413,
      );
    }

    try {
      await meter.commitReservation(reservationId, stored.size);
    } catch (err) {
      await meter.releaseReservation(reservationId);
      if (!isOverwrite) {
        await bucket.delete(r2Key).catch(() => {});
      }
      if (err instanceof Error && err.message === "STORAGE_QUOTA_EXCEEDED") {
        throw new HttpError(
          "FORBIDDEN",
          `Storage quota exceeded: upload of ${stored.size} bytes exceeds limit of ${tenant.storageLimitBytes} bytes (512 MB free tier limit)`,
          402,
        );
      }
      throw err;
    }

    // Usage event is durably recorded in TenantMeterDO SQLite outbox by commitReservation()
    // and flushed asynchronously to Neon in batches.

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

    const meter = await getTenantMeter(tenant.id);

    const readCheck = await meter.recordOperation(
      "class_b",
      "read",
      0,
      tenant.monthlyReadLimitOps,
    );
    if (!readCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly read operation quota exceeded (${readCheck.count}/${readCheck.limit} ops; 100k free tier limit)`,
        402,
      );
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    const object = await bucket.get(r2Key, options);
    if (!object) {
      throw new HttpError("NOT_FOUND", `File '${filePath}' not found`, 404);
    }

    // Usage event already recorded in TenantMeterDO SQLite outbox by recordOperation()
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

    const meter = await getTenantMeter(tenant.id);

    const writeCheck = await meter.checkOperationQuota(
      "class_a",
      tenant.monthlyWriteLimitOps,
    );
    if (!writeCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly write operation quota exceeded (${writeCheck.count}/${writeCheck.limit} ops)`,
        402,
      );
    }

    const r2Key = formatObjectKey(tenant.id, namespace.name, validated.normalized);
    const bucket = await this.bucket();

    // Only decrement quota & fileCount if the object actually existed in storage
    const existing = await bucket.head(r2Key);
    if (existing) {
      await bucket.delete(r2Key);
      await meter.deleteFile(existing.size);
    }

    return {
      success: true,
      existed: existing !== null,
      namespace: namespace.name,
      path: validated.normalized,
    };
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

    const meter = await getTenantMeter(tenant.id);
    const listCheck = await meter.recordOperation(
      "class_a",
      "list",
      0,
      tenant.monthlyWriteLimitOps,
    );
    if (!listCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly write/list operation quota exceeded (${listCheck.count}/${listCheck.limit} ops; 100k free tier limit)`,
        402,
      );
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

    const formattedObjects = result.objects.map((obj) => ({
      path: obj.key.slice(basePrefix.length),
      size: obj.size,
      etag: obj.etag,
      uploaded: obj.uploaded,
      httpMetadata: obj.httpMetadata,
    }));

    const formattedPrefixes = result.delimitedPrefixes.map((p) =>
      p.slice(basePrefix.length),
    );

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

    const meter = await getTenantMeter(tenant.id);
    const readCheck = await meter.recordOperation(
      "class_b",
      "read",
      0,
      tenant.monthlyReadLimitOps,
    );
    if (!readCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly read operation quota exceeded (${readCheck.count}/${readCheck.limit} ops; 100k free tier limit)`,
        402,
      );
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

    const srcValidated = validatePath(sourcePath);
    if (!srcValidated.valid) {
      throw new HttpError("VALIDATION_ERROR", srcValidated.error, 400);
    }
    const dstValidated = validatePath(destinationPath);
    if (!dstValidated.valid) {
      throw new HttpError("VALIDATION_ERROR", dstValidated.error, 400);
    }

    const srcNs = await this.getNamespace(tenant.id, sourceNamespace);
    if (!srcNs) {
      throw new HttpError("NOT_FOUND", `Source namespace '${sourceNamespace}' not found`, 404);
    }
    const dstNs = await this.getNamespace(tenant.id, destinationNamespace);
    if (!dstNs) {
      throw new HttpError(
        "NOT_FOUND",
        `Destination namespace '${destinationNamespace}' not found`,
        404,
      );
    }

    const meter = await getTenantMeter(tenant.id);

    const writeCheck = await meter.checkOperationQuota(
      "class_a",
      tenant.monthlyWriteLimitOps,
    );
    if (!writeCheck.ok) {
      throw new HttpError(
        "FORBIDDEN",
        `Monthly write operation quota exceeded (${writeCheck.count}/${writeCheck.limit} ops)`,
        402,
      );
    }

    const bucket = await this.bucket();

    const srcKey = formatObjectKey(tenant.id, srcNs.name, srcValidated.normalized);
    const srcObject = await bucket.get(srcKey);
    if (!srcObject) {
      throw new HttpError("NOT_FOUND", `Source file '${sourcePath}' not found`, 404);
    }

    const dstKey = formatObjectKey(tenant.id, dstNs.name, dstValidated.normalized);
    const existingDst = await bucket.head(dstKey);

    const reservation = await meter.createReservation({
      requestedBytes: srcObject.size,
      existingBytes: existingDst?.size ?? 0,
      isOverwrite: existingDst !== null,
      limitBytes: tenant.storageLimitBytes,
      objectKey: dstKey,
    });
    if (!reservation.ok || !reservation.reservation) {
      throw new HttpError(
        "FORBIDDEN",
        `Storage quota exceeded: copying ${srcObject.size} bytes exceeds limit of ${reservation.limitBytes} bytes (512 MB free tier limit)`,
        402,
      );
    }

    const body = await srcObject.arrayBuffer();

    let stored;
    try {
      stored = await bucket.put(dstKey, body, {
        httpMetadata: srcObject.httpMetadata,
        customMetadata: srcObject.customMetadata,
      });
    } catch (err) {
      await meter.releaseReservation(reservation.reservation.id);
      throw err;
    }

    await meter.commitReservation(reservation.reservation.id, stored.size);
    await meter.recordOperation("class_b", "read", srcObject.size, tenant.monthlyReadLimitOps);

    return {
      sourceNamespace: srcNs.name,
      sourcePath: srcValidated.normalized,
      destinationNamespace: dstNs.name,
      destinationPath: dstValidated.normalized,
      size: stored.size,
      etag: stored.etag,
    };
  }

  async getTenantUsage(tenantId: string): Promise<TenantUsageSnapshot> {
    const meter = await getTenantMeter(tenantId);
    return meter.getUsage();
  }

  /**
   * Reconcile R2 object bytes/counts for a tenant against TenantMeterDO and Neon.
   */
  async reconcileTenantUsage(
    tenantId: string,
  ): Promise<{ actualBytes: number; actualFileCount: number }> {
    const bucket = await this.bucket();
    const prefix = `t_${tenantId.replace(/^t_/, "")}/`;
    let cursor: string | undefined;
    let actualBytes = 0;
    let actualFileCount = 0;

    do {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const obj of page.objects) {
        actualBytes += obj.size;
        actualFileCount += 1;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    const meter = await getTenantMeter(tenantId);
    await meter.reconcile(actualBytes, actualFileCount);

    const db = await this.db();
    await db
      .update(tenants)
      .set({
        storageUsedBytes: actualBytes,
        fileCount: actualFileCount,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tenants.id, tenantId));
    await tenantKv.delete(tenantId);

    return { actualBytes, actualFileCount };
  }

  /**
   * Flush buffered usage events from the Durable Object outbox using two-phase
   * claim + ack so failed DB writes never discard usage events.
   * Events are persisted in a single idempotent transaction (`ON CONFLICT DO NOTHING`
   * on event ID + `ON CONFLICT DO UPDATE` on daily aggregates).
   */
  async flushTenantOutbox(tenantId: string, limit = 200): Promise<{ flushed: number }> {
    const meter = await getTenantMeter(tenantId);
    const claimed = await meter.claimEvents(limit);
    if (claimed.length === 0) {
      return { flushed: 0 };
    }

    const claimedIds = claimed
      .map((e) => e.id)
      .filter((id): id is number | string => id !== undefined);

    try {
      await this.persistUsageBatch(
        tenantId,
        claimed.map((evt) => ({
          eventId: evt.eventId ?? (evt.id !== undefined ? `do_${tenantId}_${evt.id}` : generateUsageEventId()),
          projectId: evt.projectId ?? null,
          timestamp: evt.timestamp,
          eventType: evt.eventType,
          classType: evt.classType,
          bytes: evt.bytes,
          ops: evt.ops,
        })),
      );
      if (claimedIds.length > 0) {
        await meter.ackEvents(claimedIds);
      }
      return { flushed: claimed.length };
    } catch (err) {
      if (claimedIds.length > 0) {
        await meter.nackEvents(claimedIds).catch(() => {});
      }
      throw err;
    }
  }

  private async persistUsageBatch(
    tenantId: string,
    events: Array<{
      eventId: string;
      projectId: string | null;
      timestamp: string;
      eventType: "read" | "write" | "delete" | "list" | "copy" | "egress";
      classType: "class_a" | "class_b";
      bytes: number;
      ops: number;
    }>,
  ): Promise<number> {
    if (events.length === 0) return 0;
    const db = await this.db();
    const nowIso = new Date().toISOString();

    return await db.transaction(async (tx) => {
      const eventRows = events.map((e) => ({
        id: e.eventId,
        tenantId,
        projectId: e.projectId,
        timestamp: e.timestamp || nowIso,
        eventType: e.eventType,
        classType: e.classType,
        bytes: e.bytes,
        ops: e.ops,
      }));

      const inserted = await tx
        .insert(usageEvents)
        .values(eventRows)
        .onConflictDoNothing()
        .returning({ id: usageEvents.id });

      const acceptedIds = new Set(inserted.map((r) => String(r.id)));
      const acceptedEvents = eventRows.filter((r) => acceptedIds.has(r.id));
      if (acceptedEvents.length === 0) {
        return 0;
      }

      // Aggregate accepted events per (projectId, date) before upserting usageDaily
      const dailyBuckets = new Map<
        string,
        {
          projectId: string;
          date: string;
          egressBytes: number;
          ingressBytes: number;
          readOps: number;
          writeOps: number;
          deleteOps: number;
        }
      >();

      for (const evt of acceptedEvents) {
        const date = evt.timestamp.slice(0, 10);
        const proj = evt.projectId ?? "";
        const bucketKey = `${proj}|${date}`;
        let bucket = dailyBuckets.get(bucketKey);
        if (!bucket) {
          bucket = {
            projectId: proj,
            date,
            egressBytes: 0,
            ingressBytes: 0,
            readOps: 0,
            writeOps: 0,
            deleteOps: 0,
          };
          dailyBuckets.set(bucketKey, bucket);
        }
        if (evt.eventType === "read" || evt.eventType === "egress") {
          bucket.egressBytes += evt.bytes;
        }
        if (evt.eventType === "write" || evt.eventType === "copy") {
          bucket.ingressBytes += evt.bytes;
        }
        if (evt.classType === "class_b") {
          bucket.readOps += evt.ops;
        } else {
          bucket.writeOps += evt.ops;
        }
        if (evt.eventType === "delete") {
          bucket.deleteOps += evt.ops;
        }
      }

      const isTestMemoryDb = Boolean(process.env.VITEST || process.env.NODE_ENV === "test");

      for (const bucket of dailyBuckets.values()) {
        if (isTestMemoryDb) {
          const existing = await tx
            .select()
            .from(usageDaily)
            .where(
              and(
                eq(usageDaily.tenantId, tenantId),
                eq(usageDaily.projectId, bucket.projectId),
                eq(usageDaily.date, bucket.date),
              ),
            );
          if (existing.length === 0) {
            await tx.insert(usageDaily).values({
              id: generateUsageDailyId(),
              tenantId,
              projectId: bucket.projectId,
              date: bucket.date,
              egressBytes: bucket.egressBytes,
              ingressBytes: bucket.ingressBytes,
              readOps: bucket.readOps,
              writeOps: bucket.writeOps,
              deleteOps: bucket.deleteOps,
              updatedAt: nowIso,
            });
          } else {
            const row = existing[0]!;
            await tx
              .update(usageDaily)
              .set({
                egressBytes: row.egressBytes + bucket.egressBytes,
                ingressBytes: row.ingressBytes + bucket.ingressBytes,
                readOps: row.readOps + bucket.readOps,
                writeOps: row.writeOps + bucket.writeOps,
                deleteOps: row.deleteOps + bucket.deleteOps,
                updatedAt: nowIso,
              })
              .where(eq(usageDaily.id, row.id));
          }
        } else {
          await tx
            .insert(usageDaily)
            .values({
              id: generateUsageDailyId(),
              tenantId,
              projectId: bucket.projectId,
              date: bucket.date,
              egressBytes: bucket.egressBytes,
              ingressBytes: bucket.ingressBytes,
              readOps: bucket.readOps,
              writeOps: bucket.writeOps,
              deleteOps: bucket.deleteOps,
              updatedAt: nowIso,
            })
            .onConflictDoUpdate({
              target: [usageDaily.tenantId, usageDaily.projectId, usageDaily.date],
              set: {
                egressBytes: sql`${usageDaily.egressBytes} + ${bucket.egressBytes}`,
                ingressBytes: sql`${usageDaily.ingressBytes} + ${bucket.ingressBytes}`,
                readOps: sql`${usageDaily.readOps} + ${bucket.readOps}`,
                writeOps: sql`${usageDaily.writeOps} + ${bucket.writeOps}`,
                deleteOps: sql`${usageDaily.deleteOps} + ${bucket.deleteOps}`,
                updatedAt: nowIso,
              },
            });
        }
      }

      return acceptedEvents.length;
    });
  }

  /* =========================================================================
   * Usage and Audit Logging
   * ========================================================================= */

  async recordUsage(
    tenantId: string,
    projectId: string | null,
    eventType: "read" | "write" | "delete" | "list" | "copy" | "egress",
    bytes = 0,
    ops = 1,
    classType: "class_a" | "class_b" = eventType === "read" || eventType === "egress"
      ? "class_b"
      : "class_a",
    idempotentEventId?: string,
  ) {
    try {
      await this.persistUsageBatch(tenantId, [
        {
          eventId: idempotentEventId ?? generateUsageEventId(),
          projectId,
          timestamp: new Date().toISOString(),
          eventType,
          classType,
          bytes,
          ops,
        },
      ]);
    } catch {
      // Direct recordUsage remains best-effort for non-outbox callers
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
  // In production the service captures a request-bound DB pool, so it must not outlive the request.
  if (!(process.env.VITEST || process.env.NODE_ENV === "test")) {
    return new StorageService();
  }
  if (!globalStorageService) {
    globalStorageService = new StorageService();
  }
  return globalStorageService;
}
