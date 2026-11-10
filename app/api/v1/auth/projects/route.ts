import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { authProjectService } from "@/lib/auth-projects/service";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { createAuthProjectSchema } from "@/lib/validators/auth-project";

export async function GET(request: NextRequest) {
  try {
    await assertRateLimit(`rl:auth-projects:list:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const list = await authProjectService.list(user.id);
    return jsonOk(list);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    await assertRateLimit(`rl:auth-projects:create:${user.id}`, {
      limit: 5,
      windowSeconds: 60,
    });
    const input = createAuthProjectSchema.parse(await readJson(request));
    const created = await authProjectService.create(user.id, input);
    return jsonOk(created, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
