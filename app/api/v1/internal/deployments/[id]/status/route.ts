import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  appendSystemLog,
  findDeployment,
  setDeploymentStatus,
} from "@/lib/build/deployments-service";
import { requireInternalToken } from "@/lib/build/internal";
import { isTerminalStatus } from "@/lib/build/status";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { internalStatusSchema } from "@/lib/validators/deployment";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: RouteContext) {
  try {
    await requireInternalToken(request);
    const id = z.uuid().parse((await ctx.params).id);
    const input = internalStatusSchema.parse(await readJson(request));

    const deployment = await findDeployment(id);
    if (!deployment) {
      throw new HttpError("NOT_FOUND", "Deployment not found.", 404);
    }
    if (isTerminalStatus(deployment.status)) {
      return jsonOk({ deployment, skipped: true });
    }
    if (input.status === "active") {
      throw new HttpError(
        "CONFLICT",
        "The builder cannot activate a deployment; the control plane does that.",
        409,
      );
    }

    const updated = await setDeploymentStatus(id, input.status, {
      ...(input.errorMessage !== undefined
        ? { errorMessage: input.errorMessage }
        : {}),
      ...(input.imageRef !== undefined ? { imageRef: input.imageRef } : {}),
    });

    if (input.status === "failed") {
      await appendSystemLog(id, "Build failed.");
    }

    return jsonOk({ deployment: updated });
  } catch (error) {
    return errorResponse(error);
  }
}