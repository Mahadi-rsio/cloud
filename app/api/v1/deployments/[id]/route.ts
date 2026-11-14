import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import {
  deploymentAppName,
  findOwnedDeployment,
} from "@/lib/build/deployments-service";
import { getDb } from "@/lib/db";
import { applications, deployments, machines } from "@/lib/db/product-schema";
import {
  destroyFlyApp,
  destroyFlyMachine,
  isFlyNotFound,
} from "@/lib/fly/client";
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

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:deployments:delete:${clientIp(request)}`, {
      limit: 30,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const deployment = await findOwnedDeployment(id, user.id);

    const flyAppName = deployment.flyAppId ?? deploymentAppName(deployment.id);
    if (deployment.flyMachineId) {
      await destroyFlyMachine(flyAppName, deployment.flyMachineId, true).catch(
        (error) => {
          if (!isFlyNotFound(error)) throw error;
        },
      );
    }
    await destroyFlyApp(flyAppName).catch((error) => {
      if (!isFlyNotFound(error)) throw error;
    });

    const db = await getDb();
    const [linkedApp] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.slug, flyAppName), eq(applications.userId, user.id)))
      .limit(1);

    if (linkedApp) {
      await db
        .update(machines)
        .set({ status: "destroyed", updatedAt: new Date() })
        .where(eq(machines.applicationId, linkedApp.id));
      await db
        .update(applications)
        .set({
          status: "deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
          lastOperationAt: new Date(),
        })
        .where(eq(applications.id, linkedApp.id));
    }

    await db.delete(deployments).where(eq(deployments.id, deployment.id));

    return jsonOk({ deleted: true, id: deployment.id });
  } catch (error) {
    return errorResponse(error);
  }
}