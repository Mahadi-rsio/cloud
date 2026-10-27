import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import {
  appendSystemLog,
  findOwnedDeployment,
  nextBuildNumber,
  setDeploymentStatus,
} from "@/lib/build/deployments-service";
import { enqueueDeployJob } from "@/lib/build/process-job";
import { canRetry } from "@/lib/build/status";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:deployments:retry:${clientIp(request)}`, {
      limit: 10,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const deployment = await findOwnedDeployment(id, user.id);

    if (!canRetry(deployment.status)) {
      throw new HttpError(
        "CONFLICT",
        "This deployment is still in progress and cannot be retried yet.",
        409,
      );
    }

    await nextBuildNumber(deployment.id);
    const updated = await setDeploymentStatus(deployment.id, "queued", {
      errorMessage: null,
    });
    await appendSystemLog(
      deployment.id,
      `Retry requested for ${deployment.repoOwner}/${deployment.repoName}@${deployment.branch}.`,
    );
    await enqueueDeployJob({ type: "deploy-build", deploymentId: deployment.id });

    return jsonOk({ deployment: updated });
  } catch (error) {
    return errorResponse(error);
  }
}