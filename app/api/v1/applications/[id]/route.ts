import { and, asc, eq, ne } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertOwnership, requireUser } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { applications, machines } from "@/lib/db/product-schema";
import {
  destroyFlyApp,
  destroyFlyMachine,
  getFlyMachine,
  isFlyNotFound,
  mergeMachineConfig,
  updateFlyMachine,
} from "@/lib/fly/client";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import {
  updateApplicationSchema,
  type RuntimeInput,
} from "@/lib/validators/application";

type RouteContext = { params: Promise<{ id: string }> };

function machineStatus(state: string | undefined) {
  switch (state) {
    case "started":
    case "created":
      return "running";
    case "starting":
      return "starting";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    default:
      return "provisioning";
  }
}

async function findOwnedApplication(id: string, userId: string) {
  const db = await getDb();
  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.id, id))
    .limit(1);

  if (!application || application.deletedAt) {
    throw new HttpError("NOT_FOUND", "Application not found.", 404);
  }
  assertOwnership(application.userId, userId);
  return { db, application };
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:applications:read:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const { db, application } = await findOwnedApplication(id, user.id);

    const machineRows = await db
      .select()
      .from(machines)
      .where(eq(machines.applicationId, id))
      .orderBy(asc(machines.createdAt));

    return jsonOk({ application, machines: machineRows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:applications:update:${clientIp(request)}`, {
      limit: 60,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const input = updateApplicationSchema.parse(await readJson(request));
    const { db, application } = await findOwnedApplication(id, user.id);

    if (application.status === "deleting" || application.status === "deleted") {
      throw new HttpError("CONFLICT", "Application is being deleted.", 409);
    }

    const [machine] = await db
      .select()
      .from(machines)
      .where(and(eq(machines.applicationId, id), ne(machines.status, "destroyed")))
      .limit(1);

    const nextRegion = input.region ?? application.region;
    const currentRuntime = (application.runtime as RuntimeInput | null) ?? undefined;
    const nextRuntime = input.runtime
      ? {
          ...currentRuntime,
          ...input.runtime,
          guest: input.runtime.guest
            ? { ...currentRuntime?.guest, ...input.runtime.guest }
            : currentRuntime?.guest,
          env: input.runtime.env
            ? { ...currentRuntime?.env, ...input.runtime.env }
            : currentRuntime?.env,
        }
      : currentRuntime;

    if (machine?.flyMachineId && (input.runtime || input.region)) {
      const current = await getFlyMachine(application.slug, machine.flyMachineId);
      const updated = await updateFlyMachine(application.slug, machine.flyMachineId, {
        config: mergeMachineConfig(current.config, input.runtime),
        currentVersion: current.version,
        region: nextRegion,
      });

      await db
        .update(machines)
        .set({
          status: machineStatus(updated.state),
          region: updated.region ?? nextRegion,
          allocatedResources:
            input.runtime?.guest ?? (machine.allocatedResources as unknown),
          updatedAt: new Date(),
        })
        .where(eq(machines.id, machine.id));
    }

    const [updatedApplication] = await db
      .update(applications)
      .set({
        name: input.name ?? application.name,
        region: nextRegion,
        runtime: nextRuntime ?? null,
        updatedAt: new Date(),
        lastOperationAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();

    return jsonOk({ application: updatedApplication });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  try {
    await assertRateLimit(`rl:applications:delete:${clientIp(request)}`, {
      limit: 30,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const { db, application } = await findOwnedApplication(id, user.id);

    if (application.status === "deleting") {
      throw new HttpError("CONFLICT", "Application deletion already in progress.", 409);
    }

    await db
      .update(applications)
      .set({ status: "deleting", updatedAt: new Date(), lastOperationAt: new Date() })
      .where(eq(applications.id, id));

    const [machine] = await db
      .select()
      .from(machines)
      .where(and(eq(machines.applicationId, id), ne(machines.status, "destroyed")))
      .limit(1);

    try {
      if (machine?.flyMachineId) {
        await destroyFlyMachine(application.slug, machine.flyMachineId, true).catch(
          (error) => {
            if (!isFlyNotFound(error)) throw error;
          },
        );
      }
      await destroyFlyApp(application.slug).catch((error) => {
        if (!isFlyNotFound(error)) throw error;
      });
    } catch (error) {
      await db
        .update(applications)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(applications.id, id));
      throw error;
    }

    await db
      .update(machines)
      .set({ status: "destroyed", updatedAt: new Date() })
      .where(eq(machines.applicationId, id));

    const [deletedApplication] = await db
      .update(applications)
      .set({
        status: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
        lastOperationAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();

    return jsonOk({ application: deletedApplication });
  } catch (error) {
    return errorResponse(error);
  }
}
