import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deploymentLogs, deployments } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import {
  allocateSharedIpv4,
  createFlyApp,
  createFlyMachine,
  getFlyMachine,
  isFlyNotFound,
  mergeMachineConfig,
  updateFlyMachine,
} from "@/lib/fly/client";
import { HttpError } from "@/lib/http";
import {
  canTransition,
  isTerminalStatus,
  type DeploymentStatus,
} from "@/lib/build/status";
import type { DeploymentLogStream } from "@/lib/build/logs";
import { deploymentAppName } from "@/lib/build/names";

export { deploymentAppName } from "@/lib/build/names";

export type Deployment = typeof deployments.$inferSelect;
export type DeploymentLog = typeof deploymentLogs.$inferSelect;

export async function findDeployment(id: string): Promise<Deployment | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, id))
    .limit(1);
  return row ?? null;
}

export async function findOwnedDeployment(
  id: string,
  userId: string,
): Promise<Deployment> {
  const deployment = await findDeployment(id);
  if (!deployment) {
    throw new HttpError("NOT_FOUND", "Deployment not found.", 404);
  }
  if (deployment.userId !== userId) {
    throw new HttpError("FORBIDDEN", "You do not have access to this resource.", 403);
  }
  return deployment;
}

export async function appendDeploymentLogs(
  deploymentId: string,
  entries: Array<{ stream: DeploymentLogStream; message: string }>,
): Promise<DeploymentLog[]> {
  if (entries.length === 0) return [];
  const db = await getDb();
  return db
    .insert(deploymentLogs)
    .values(
      entries.map((entry) => ({
        deploymentId,
        stream: entry.stream,
        message: entry.message,
      })),
    )
    .returning();
}

export async function appendSystemLog(deploymentId: string, message: string) {
  return appendDeploymentLogs(deploymentId, [{ stream: "system", message }]);
}

/**
 * Move a deployment to a new status, enforcing the pipeline order. Same-state
 * updates are allowed so callers can be retried safely.
 */
export async function setDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
  patch: Partial<{
    errorMessage: string | null;
    imageRef: string | null;
    flyAppId: string | null;
    flyMachineId: string | null;
    publicUrl: string | null;
    commitSha: string | null;
  }> = {},
): Promise<Deployment> {
  const current = await findDeployment(deploymentId);
  if (!current) {
    throw new HttpError("NOT_FOUND", "Deployment not found.", 404);
  }
  if (!canTransition(current.status, status)) {
    throw new HttpError(
      "CONFLICT",
      `Cannot move deployment from ${current.status} to ${status}.`,
      409,
    );
  }

  const now = new Date();
  const isStarting = status !== "queued" && !current.startedAt;
  const isEnding = isTerminalStatus(status);

  const db = await getDb();
  const [updated] = await db
    .update(deployments)
    .set({
      status,
      ...patch,
      ...(isStarting ? { startedAt: now } : {}),
      ...(isEnding ? { finishedAt: now } : {}),
      ...(status === "queued" ? { startedAt: null, finishedAt: null } : {}),
      updatedAt: now,
    })
    .where(eq(deployments.id, deploymentId))
    .returning();

  return updated;
}

export async function markDeploymentFailed(deploymentId: string, message: string) {
  await appendDeploymentLogs(deploymentId, [
    { stream: "stderr", message },
    { stream: "system", message: "Deployment failed." },
  ]);
  const current = await findDeployment(deploymentId);
  if (!current) return;
  if (current.status === "failed") {
    const db = await getDb();
    await db
      .update(deployments)
      .set({ errorMessage: message, updatedAt: new Date() })
      .where(eq(deployments.id, deploymentId));
    return;
  }
  await setDeploymentStatus(deploymentId, "failed", { errorMessage: message });
}

export async function listDeploymentLogs(input: {
  deploymentId: string;
  after?: number | null;
  limit?: number;
}): Promise<DeploymentLog[]> {
  const db = await getDb();
  const conditions = [eq(deploymentLogs.deploymentId, input.deploymentId)];
  if (typeof input.after === "number" && input.after > 0) {
    conditions.push(gt(deploymentLogs.id, input.after));
  }
  return db
    .select()
    .from(deploymentLogs)
    .where(and(...conditions))
    .orderBy(asc(deploymentLogs.id))
    .limit(Math.min(Math.max(input.limit ?? 500, 1), 500));
}

export async function listDeployments(input: {
  userId: string;
  limit?: number;
}): Promise<Deployment[]> {
  const db = await getDb();
  return db
    .select()
    .from(deployments)
    .where(eq(deployments.userId, input.userId))
    .orderBy(desc(deployments.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
}

/**
 * Resolve the Fly app that owns this deployment's images, creating it when
 * missing. The app must exist before the builder pushes the image so the
 * app-scoped registry namespace (`registry.fly.io/<app>:<tag>`) is writable —
 * Fly's registry rejects repositories that do not match a real app.
 */
export async function ensureDeploymentFlyApp(
  deployment: Deployment,
): Promise<string> {
  const appName = deployment.flyAppId ?? deploymentAppName(deployment.id);
  if (deployment.flyAppId) return appName;

  const env = await getEnv();
  try {
    await createFlyApp({
      name: appName,
      orgSlug: env.FLY_ORG_SLUG,
      idempotencyKey: deployment.id,
    });
  } catch (error) {
    // A previous attempt may have created the app before failing.
    if (!isFlyNotFound(error)) {
      const status = (error as { providerStatus?: number }).providerStatus;
      if (status !== 422 && status !== 409) throw error;
    }
  }
  return appName;
}

export type DeployImageResult = {
  flyAppId: string;
  flyMachineId: string;
  publicUrl: string;
};

/**
 * Deploy a freshly pushed OCI image to Fly. Creates the app and machine on the
 * first deploy and rolls the machine to the new image on subsequent builds.
 * Only the control plane holds Fly credentials — the builder never sees them.
 */
export async function deployImageToFly(input: {
  deployment: Deployment;
  imageRef: string;
  internalPort: number;
}): Promise<DeployImageResult> {
  const env = await getEnv();
  const region = env.FLY_DEFAULT_REGION ?? "sin";
  const appName = await ensureDeploymentFlyApp(input.deployment);

  const runtime = {
    image: input.imageRef,
    internalPort: input.internalPort,
    guest: { cpu_kind: "shared" as const, cpus: 1, memory_mb: 512 },
    env: { PORT: String(input.internalPort) },
  };

  let machineId = input.deployment.flyMachineId;

  if (!machineId) {
    const machine = await createFlyMachine({
      appName,
      region,
      runtime,
      name: appName,
    });
    machineId = machine.id;
    // Free shared IPv4 only; ignore "already allocated".
    await allocateSharedIpv4(appName).catch(() => undefined);
  } else {
    try {
      const current = await getFlyMachine(appName, machineId);
      const config = mergeMachineConfig(current.config, runtime);
      await updateFlyMachine(appName, machineId, {
        config,
        currentVersion: current.version,
        region: current.region ?? region,
      });
    } catch (error) {
      if (!isFlyNotFound(error)) throw error;
      // Machine was deleted out-of-band; recreate it.
      const machine = await createFlyMachine({ appName, region, runtime, name: appName });
      machineId = machine.id;
      await allocateSharedIpv4(appName).catch(() => undefined);
    }
  }

  return {
    flyAppId: appName,
    flyMachineId: machineId,
    publicUrl: `https://${appName}.fly.dev`,
  };
}

export async function nextBuildNumber(deploymentId: string): Promise<number> {  const db = await getDb();
  const [row] = await db
    .update(deployments)
    .set({
      buildNumber: sql`${deployments.buildNumber} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(deployments.id, deploymentId))
    .returning({ buildNumber: deployments.buildNumber });
  return row?.buildNumber ?? 1;
}

/**
 * Internal, trusted transition used by the builder's `complete` callback.
 * The builder may skip status pings if it is fast, so we jump straight to
 * `deploying` (unless the deployment already reached a terminal state).
 */
export async function advanceDeploymentToDeploying(
  deploymentId: string,
  imageRef: string,
): Promise<Deployment | null> {
  const current = await findDeployment(deploymentId);
  if (!current) return null;
  if (isTerminalStatus(current.status)) return current;

  const db = await getDb();
  const now = new Date();
  const [updated] = await db
    .update(deployments)
    .set({
      status: "deploying",
      imageRef,
      startedAt: current.startedAt ?? now,
      updatedAt: now,
    })
    .where(eq(deployments.id, deploymentId))
    .returning();
  return updated ?? null;
}
