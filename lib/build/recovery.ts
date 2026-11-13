import { and, eq, inArray, lt } from "drizzle-orm";
import { markDeploymentFailed } from "@/lib/build/deployments-service";
import { isTerminalStatus } from "@/lib/build/status";
import { getDb } from "@/lib/db";
import { deployments } from "@/lib/db/product-schema";
import { TypedKvCache } from "@/lib/kv";

const IN_FLIGHT = ["queued", "preparing", "building", "pushing", "deploying"] as const;
const ACTIVE_HINT_KV = new TypedKvCache("build:recovery", "v1");

/**
 * A build that stops heartbeating for this long is considered dead. The builder
 * pings its status every minute, so 10 minutes of silence means the machine was
 * killed or crashed. Marking it failed stops the dashboard from hanging and
 * lets the user retry.
 */
export const STALE_BUILD_AFTER_MS = 10 * 60 * 1000;

export async function markActiveDeploymentHint(): Promise<void> {
  await ACTIVE_HINT_KV.setJson(
    "active",
    { at: Date.now() },
    { kvTtlSeconds: 1800, l1TtlMs: 30_000 },
  );
}

export async function hasActiveDeploymentHint(): Promise<boolean> {
  const hint = await ACTIVE_HINT_KV.getJson<{ at: number }>("active", {
    l1TtlMs: 10_000,
  });
  return hint !== null;
}

/**
 * Idempotent single-deployment recovery invoked by DeploymentStreamDO.alarm().
 */
export async function recoverSingleDeployment(
  deploymentId: string,
  now: Date = new Date(),
): Promise<{
  outcome: "recovered" | "reschedule" | "noop";
  nextDeadlineMs?: number;
}> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: deployments.id,
      status: deployments.status,
      updatedAt: deployments.updatedAt,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  if (!row || isTerminalStatus(row.status)) {
    return { outcome: "noop" };
  }

  const updatedAtMs = new Date(row.updatedAt).getTime();
  const staleAtMs = updatedAtMs + STALE_BUILD_AFTER_MS;
  if (now.getTime() < staleAtMs) {
    return { outcome: "reschedule", nextDeadlineMs: staleAtMs };
  }

  await markDeploymentFailed(
    row.id,
    "The build stopped responding and timed out. Please retry the deployment.",
  );
  return { outcome: "recovered" };
}

/**
 * Low-frequency reconciliation fallback for deployments whose DO alarm was lost.
 */
export async function recoverStaleDeployments(
  now: Date = new Date(),
): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - STALE_BUILD_AFTER_MS);
  const stale = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(
      and(
        inArray(deployments.status, [...IN_FLIGHT]),
        lt(deployments.updatedAt, cutoff),
      ),
    );

  for (const row of stale) {
    await markDeploymentFailed(
      row.id,
      "The build stopped responding and timed out. Please retry the deployment.",
    );
  }

  if (stale.length === 0) {
    await ACTIVE_HINT_KV.delete("active");
  }

  return stale.length;
}
