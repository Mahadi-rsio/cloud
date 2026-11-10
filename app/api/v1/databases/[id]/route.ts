import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { databaseService } from "@/lib/databases/service";
import { errorResponse, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:databases:get:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.string().uuid().parse((await ctx.params).id);
    const database = await databaseService.get(id, user.id);
    return jsonOk(database);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:databases:delete:${clientIp(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.string().uuid().parse((await ctx.params).id);
    const result = await databaseService.delete(id, user.id);
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}
