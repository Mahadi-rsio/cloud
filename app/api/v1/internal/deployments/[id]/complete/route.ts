import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  advanceDeploymentToDeploying,
  appendSystemLog,
  deployImageToFly,
  findDeployment,
  markDeploymentFailed,
  setDeploymentStatus,
} from "@/lib/build/deployments-service";
import { requireInternalToken } from "@/lib/build/internal";
import { isTerminalStatus } from "@/lib/build/status";
import { buildDefaultInternalPort, getEnv } from "@/lib/env";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { internalCompleteSchema } from "@/lib/validators/deployment";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Called by the builder once the image has been pushed. The control plane owns
 * the Fly credentials, so the actual deploy happens here.
 */
export async function POST(request: NextRequest, ctx: RouteContext) {
  try {
    await requireInternalToken(request);
    const id = z.uuid().parse((await ctx.params).id);
    const input = internalCompleteSchema.parse(await readJson(request));

    const current = await findDeployment(id);
    if (!current) {
      throw new HttpError("NOT_FOUND", "Deployment not found.", 404);
    }
    if (isTerminalStatus(current.status)) {
      return jsonOk({ deployment: current, skipped: true });
    }

    // Avoid duplicate concurrent deployments if another call is already deploying
    if (
      current.status === "deploying" &&
      current.updatedAt &&
      Date.now() - new Date(current.updatedAt).getTime() < 120_000
    ) {
      return jsonOk({ deployment: current, skipped: true, inProgress: true });
    }

    await appendSystemLog(id, `Build finished. Image: ${input.imageRef}`);
    const deploying = await advanceDeploymentToDeploying(id, input.imageRef);
    const env = await getEnv();
    const internalPort =
      input.internalPort ?? buildDefaultInternalPort(env);
    // Never skip port detection: always verify and auto-detect the actual listening port on the machine
    const skipPortDetection = false;

    try {
      const result = await deployImageToFly({
        deployment: deploying ?? current,
        imageRef: input.imageRef,
        internalPort,
        skipPortDetection,
      });

      const updated = await setDeploymentStatus(id, "active", {
        flyAppId: result.flyAppId,
        flyMachineId: result.flyMachineId,
        publicUrl: result.publicUrl,
        imageRef: input.imageRef,
        errorMessage: null,
        ...(input.commitSha ? { commitSha: input.commitSha } : {}),
      });
      await appendSystemLog(id, `Deployment is live at ${result.publicUrl}`);

      return jsonOk({ deployment: updated });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Deployment to Fly failed.";
      await markDeploymentFailed(id, message);
      return errorResponse(error);
    }
  } catch (error) {
    return errorResponse(error);
  }
}