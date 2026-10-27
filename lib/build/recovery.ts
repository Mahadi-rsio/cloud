import { and, inArray, lt } from "drizzle-orm";
import { markDeploymentFailed } from "@/lib/build/deployments-service";
import { getDb } from "@/lib/db";
import { deployments } from "@/lib/db/product-schema";

const IN_FLIGHT = ["preparing", "building", "pushing", "deploying"] as const;

/**
 * A build that stops heartbeating for this long is considered dead. The builder
 * pings its status every minute, so 10 minutes of silence means the machine was
 * killed or crashed. Marking it failed stops the dashboard from hanging and
 * lets the user retry.
 */
export const STALE_BUILD_AFTER_MS = 10 * 60 * 1000;

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

  return stale.length;
}