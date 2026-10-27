import type { NextRequest } from "next/server";
import { z } from "zod";
import { appendDeploymentLogs } from "@/lib/build/deployments-service";
import { requireInternalToken } from "@/lib/build/internal";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { internalLogsSchema } from "@/lib/validators/deployment";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: RouteContext) {
  try {
    await requireInternalToken(request);
    const id = z.uuid().parse((await ctx.params).id);
    const input = internalLogsSchema.parse(await readJson(request));
    const rows = await appendDeploymentLogs(id, input.entries);
    return jsonOk({ count: rows.length, lastId: rows.at(-1)?.id ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}