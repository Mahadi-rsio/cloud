import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { applications, machines } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import { createFlyApp, createFlyMachine, destroyFlyApp } from "@/lib/fly/client";
import { errorResponse, jsonOk, readJson } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";
import { createApplicationSchema } from "@/lib/validators/application";

function generateAppSlug(name: string) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);

  if (!base) base = "app";
  if (!/^[a-z]/.test(base)) base = `app-${base}`;

  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${base}-${suffix}`;
}

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

export async function POST(request: NextRequest) {
  try {
    await assertRateLimit(`rl:applications:create:${clientIp(request)}`, {
      limit: 20,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const input = createApplicationSchema.parse(await readJson(request));
    const env = await getEnv();
    const region = input.region ?? env.FLY_DEFAULT_REGION ?? "sin";
    const slug = generateAppSlug(input.name);
    const db = await getDb();

    const [application] = await db
      .insert(applications)
      .values({
        userId: user.id,
        name: input.name,
        slug,
        status: "provisioning",
        region,
        runtime: input.runtime ?? null,
        requestedResources: input.runtime?.guest ?? null,
        lastOperationAt: new Date(),
      })
      .returning();

    let flyMachine;
    try {
      await createFlyApp({
        name: slug,
        orgSlug: env.FLY_ORG_SLUG,
        idempotencyKey: application.id,
      });
      flyMachine = await createFlyMachine({
        appName: slug,
        region,
        runtime: input.runtime,
        name: slug,
      });
    } catch (error) {
      await db
        .update(applications)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(applications.id, application.id));
      await destroyFlyApp(slug).catch(() => undefined);
      throw error;
    }

    const status = machineStatus(flyMachine.state);
    const [machine] = await db
      .insert(machines)
      .values({
        applicationId: application.id,
        flyMachineId: flyMachine.id,
        status,
        region: flyMachine.region ?? region,
        instanceNumber: 0,
        publicUrl: input.runtime?.internalPort ? `https://${slug}.fly.dev` : null,
        allocatedResources: input.runtime?.guest ?? null,
      })
      .returning();

    const [updatedApplication] = await db
      .update(applications)
      .set({
        status: status === "failed" ? "failed" : "running",
        updatedAt: new Date(),
        lastOperationAt: new Date(),
      })
      .where(eq(applications.id, application.id))
      .returning();

    return jsonOk({ application: updatedApplication, machine }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
