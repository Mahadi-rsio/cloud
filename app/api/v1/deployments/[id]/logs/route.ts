import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import {
  findOwnedDeployment,
  listDeploymentLogs,
} from "@/lib/build/deployments-service";
import { isTerminalStatus } from "@/lib/build/status";
import { MAX_LOG_BATCH, parseLogCursor } from "@/lib/build/logs";
import { errorResponse, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:deployments:logs:${clientIp(request)}`, {
      limit: 240,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const deployment = await findOwnedDeployment(id, user.id);

    const searchParams = request.nextUrl.searchParams;
    const after = parseLogCursor(searchParams.get("after"));
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_LOG_BATCH)
      .default(MAX_LOG_BATCH)
      .parse(searchParams.get("limit") ?? undefined);

    const rows = await listDeploymentLogs({
      deploymentId: deployment.id,
      after,
      limit,
    });

    const items = rows.map((row) => ({
      id: row.id,
      stream: row.stream,
      message: row.message,
      timestamp: row.createdAt.toISOString(),
    }));

    return jsonOk({
      items,
      nextCursor: items.length > 0 ? items[items.length - 1].id : (after ?? 0),
      status: deployment.status,
      terminal: isTerminalStatus(deployment.status),
    });
  } catch (error) {
    return errorResponse(error);
  }
}