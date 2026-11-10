import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { databaseService } from "@/lib/databases/service";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { createDatabaseSchema } from "@/lib/validators/database";

export async function GET(request: NextRequest) {
  try {
    await assertRateLimit(`rl:databases:list:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const list = await databaseService.list(user.id);
    return jsonOk(list);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:databases:create:${clientIp(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const input = createDatabaseSchema.parse(await readJson(request));
    const created = await databaseService.create(user.id, input);
    return jsonOk(created, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
