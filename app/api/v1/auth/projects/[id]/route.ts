import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { authProjectService } from "@/lib/auth-projects/service";
import { errorResponse, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:auth-projects:get:${clientIp(request)}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.string().uuid().parse((await ctx.params).id);
    const project = await authProjectService.get(id, user.id);
    return jsonOk(project);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:auth-projects:delete:${clientIp(request)}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.string().uuid().parse((await ctx.params).id);
    const result = await authProjectService.delete(id, user.id);
    return jsonOk(result);
  } catch (error) {
    return errorResponse(error);
  }
}
