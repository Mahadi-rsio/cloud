import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { findOwnedDeployment } from "@/lib/build/deployments-service";
import { errorResponse, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:deployments:get:${clientIp(request)}`, {
      limit: 240,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const deployment = await findOwnedDeployment(id, user.id);
    return jsonOk({ deployment });
  } catch (error) {
    return errorResponse(error);
  }
}