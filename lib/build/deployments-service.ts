import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { deploymentLogs, deployments } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import {
  allocateSharedIpv4,
  createFlyApp,
  createFlyMachine,
  execInFlyMachine,
  getFlyMachine,
  isFlyNotFound,
  listFlyMachines,
  mergeMachineConfig,
  startFlyMachine,
  updateFlyMachine,
  type FlyMachine,
} from "@/lib/fly/client";
import { decidePort, parseListeningPorts } from "@/lib/fly/port-detection";
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
  const db = await getDb();

  // The read-check-write below is guarded by `status = <observed status>` so a
  // concurrent transition cannot be silently overwritten by a stale callback
  // (e.g. a late `pushing` ping racing the `complete` callback's `deploying`).
  // When the guard loses the race we re-read and re-validate.
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
      .where(and(eq(deployments.id, deploymentId), eq(deployments.status, current.status)))
      .returning();

    if (updated) return updated;
  }

  const latest = await findDeployment(deploymentId);
  throw new HttpError(
    "CONFLICT",
    `Cannot move deployment from ${latest?.status ?? "unknown"} to ${status}.`,
    409,
  );
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

// ---------------------------------------------------------------------------
// Port verification (once per deployment)
// ---------------------------------------------------------------------------

const PORT_POLL_INTERVAL_MS = 3_000;
const PORT_POLL_TIMEOUT_MS = 90_000;
const PORT_EXEC_TIMEOUT_S = 8;

/**
 * After a machine is running, poll /proc/net/tcp[6] to discover which port
 * the app actually listens on and reconcile it with the configured
 * `internalPort`.
 *
 * - Configured port reachable  → done, nothing to update.
 * - Other reachable port found → update machine services + PORT env var,
 *   restart once.
 * - Loopback-only              → throw with a clear user-facing message.
 * - Nothing after timeout      → throw with a clear user-facing message.
 * - exec not available         → log a warning and return (graceful degrade).
 *
 * When `skipDetection` is true (user has explicitly set `internalPort` via
 * application runtime settings) we skip re-detection but still log a warning
 * if nothing answers on the configured port.
 */
async function verifyAndCorrectPort(input: {
  deploymentId: string;
  appName: string;
  machineId: string;
  configuredPort: number;
  skipDetection: boolean;
  region: string;
}): Promise<void> {
  const { deploymentId, appName, machineId, configuredPort, skipDetection, region } = input;

  await appendSystemLog(deploymentId, "Waiting for the app to listen on a port…");

  // Ensure the machine is started.
  const initial = await getFlyMachine(appName, machineId).catch(() => null);
  if (initial?.state === "stopped" || initial?.state === "created") {
    await startFlyMachine(appName, machineId).catch(() => undefined);
  }

  const deadline = Date.now() + PORT_POLL_TIMEOUT_MS;
  let lastPorts: { reachable: number[]; loopbackOnly: number[] } = {
    reachable: [],
    loopbackOnly: [],
  };
  let consecutiveExecFailures = 0;

  while (Date.now() < deadline) {
    // Wait for the machine to reach 'started' before exec.
    const machine = await getFlyMachine(appName, machineId).catch(() => null);
    if (!machine) break;

    if (machine.state !== "started" && machine.state !== "running") {
      await new Promise((r) => setTimeout(r, PORT_POLL_INTERVAL_MS));
      continue;
    }

    const execResult = await execInFlyMachine(
      appName,
      machineId,
      ["sh", "-c", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true"],
      PORT_EXEC_TIMEOUT_S,
    );

    if (execResult === null) {
      consecutiveExecFailures += 1;
      // Machine might still be starting or guest agent warming up. Only degrade
      // gracefully if exec consistently fails (8+ attempts = 24s+) or deadline near.
      if (consecutiveExecFailures >= 8 || Date.now() + PORT_POLL_INTERVAL_MS >= deadline) {
        await appendSystemLog(
          deploymentId,
          "Port detection unavailable (exec not supported or machine not responding). Using configured port " +
            configuredPort +
            ".",
        );
        return;
      }
      await new Promise((r) => setTimeout(r, PORT_POLL_INTERVAL_MS));
      continue;
    }

    consecutiveExecFailures = 0;
    lastPorts = parseListeningPorts(execResult.stdout ?? "");

    if (lastPorts.reachable.length > 0 || lastPorts.loopbackOnly.length > 0) {
      break; // Got a definitive answer; stop polling.
    }

    // Nothing yet — app may still be starting.
    await new Promise((r) => setTimeout(r, PORT_POLL_INTERVAL_MS));
  }

  const decision = decidePort({
    configured: configuredPort,
    reachable: lastPorts.reachable,
    loopbackOnly: lastPorts.loopbackOnly,
  });

  switch (decision.action) {
    case "ok":
      await appendSystemLog(
        deploymentId,
        `App is listening on port ${decision.port}. Port configuration confirmed.`,
      );
      return;

    case "update": {
      if (skipDetection) {
        // User explicitly set a port; trust it but warn.
        await appendSystemLog(
          deploymentId,
          `Warning: app listens on port ${decision.port} but configured port is ${configuredPort}. ` +
            `Using configured port (manual override is set).`,
        );
        return;
      }

      const detectedPort = decision.port;
      await appendSystemLog(
        deploymentId,
        `Detected listening port ${detectedPort}; updating routing (was ${configuredPort}).`,
      );

      // Re-fetch current machine state for version + existing config.
      const current = await getFlyMachine(appName, machineId);
      const updatedConfig = mergeMachineConfig(current.config, {
        internalPort: detectedPort,
        env: { PORT: String(detectedPort) },
      });
      await updateFlyMachine(appName, machineId, {
        config: updatedConfig,
        currentVersion: current.version,
        region: current.region ?? region,
      });
      await appendSystemLog(
        deploymentId,
        `Routing updated to port ${detectedPort}. Machine restarting.`,
      );
      return;
    }

    case "fail-loopback": {
      const ports = decision.ports.join(", ");
      throw new Error(
        `App listens only on 127.0.0.1:${ports}. ` +
          `It must listen on 0.0.0.0 (use the PORT environment variable, PORT=${configuredPort}).`,
      );
    }

    case "fail-none":
      throw new Error(
        `No open port detected after ${PORT_POLL_TIMEOUT_MS / 1000}s. ` +
          `The app must listen on 0.0.0.0:$PORT (PORT=${configuredPort}).`,
      );
  }
}

/**
 * Deploy a freshly pushed OCI image to Fly. Creates the app and machine on the
 * first deploy and rolls the machine to the new image on subsequent builds.
 * Only the control plane holds Fly credentials — the builder never sees them.
 *
 * After the machine is running, verifies (once per deployment) that the app
 * actually listens on the expected port.  If it listens elsewhere, the machine
 * services config is updated automatically.  If nothing listens, the
 * deployment is failed with a clear message before it is marked active.
 */
export async function deployImageToFly(input: {
  deployment: Deployment;
  imageRef: string;
  internalPort: number;
  /** True when the user explicitly configured internalPort (skip auto-detect). */
  skipPortDetection?: boolean;
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
    // A previous attempt may have created the machine without persisting its id
    // (e.g. the status update failed after the Fly call). Reuse a machine that
    // already has this app's name instead of failing with "already exists".
    const existing = (await listFlyMachines(appName).catch(() => [] as FlyMachine[])).find(
      (machine) => machine.name === appName,
    );
    if (existing) {
      machineId = existing.id;
      const config = mergeMachineConfig(existing.config, runtime);
      await updateFlyMachine(appName, machineId, {
        config,
        currentVersion: existing.version,
        region: existing.region ?? region,
      });
      await allocateSharedIpv4(appName).catch(() => undefined);
    } else {
      const machine = await createFlyMachine({
        appName,
        region,
        runtime,
        name: appName,
      });
      machineId = machine.id;
      // Free shared IPv4 only; ignore "already allocated".
      await allocateSharedIpv4(appName).catch(() => undefined);
    }
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

  // Once per deployment: verify the app actually listens on the expected port.
  // This must complete before we mark the deployment active so users never see
  // a live deployment that 502s due to a wrong port.
  await verifyAndCorrectPort({
    deploymentId: input.deployment.id,
    appName,
    machineId,
    configuredPort: input.internalPort,
    skipDetection: input.skipPortDetection ?? false,
    region,
  });

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
    .where(and(eq(deployments.id, deploymentId), eq(deployments.status, current.status)))
    .returning();
  return updated ?? (await findDeployment(deploymentId));
}
