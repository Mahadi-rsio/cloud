import { and, asc, desc, eq, gt, isNull, lt, or, type SQL } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { applications, machines } from "@/lib/db/product-schema";
import { getEnv } from "@/lib/env";
import { createFlyApp, createFlyMachine, destroyFlyApp } from "@/lib/fly/client";
import { errorResponse, HttpError, jsonOk, readJson } from "@/lib/http";
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

type Application = typeof applications.$inferSelect;
type Cursor = { at: Date; id: string };

const ALLOWED_SORTS = [
  "updated_at_desc",
  "updated_at_asc",
  "created_at_desc",
  "created_at_asc",
];
const ALLOWED_STATUSES = [
  "pending",
  "provisioning",
  "running",
  "failed",
  "deleting",
  "deleted",
];
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 100;

function encodeCursor(application: Application, sort: string) {
  const at =
    sort.startsWith("created_at") ? application.createdAt : application.updatedAt;
  return btoa(`${at.toISOString()}|${application.id}`);
}

function parseCursor(raw: string): Cursor {
  const [iso, id] = atob(raw).split("|", 2);
  const at = new Date(iso);
  const parsedId = z.uuid().parse(id);
  if (Number.isNaN(at.getTime())) {
    throw new HttpError("VALIDATION_ERROR", "Invalid cursor.", 400);
  }
  return { at, id: parsedId };
}

export async function GET(request: NextRequest) {
  try {
    await assertRateLimit(`rl:applications:list:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();

    const url = new URL(request.url);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(LIST_LIMIT_MAX)
      .default(LIST_LIMIT_DEFAULT)
      .parse(url.searchParams.get("limit") ?? undefined);
    const sort = z
      .enum(ALLOWED_SORTS)
      .default("updated_at_desc")
      .parse(url.searchParams.get("sort") ?? undefined);
    const status = z
      .enum(ALLOWED_STATUSES)
      .optional()
      .parse(url.searchParams.get("filter[status]") ?? undefined);
    const cursorRaw = url.searchParams.get("cursor");
    const cursor = cursorRaw ? parseCursor(cursorRaw) : undefined;

    const orderColumn = sort.startsWith("created_at")
      ? applications.createdAt
      : applications.updatedAt;
    const dir = sort.endsWith("asc") ? "asc" : "desc";
    const conditions: (SQL | undefined)[] = [
      eq(applications.userId, user.id),
      isNull(applications.deletedAt),
    ];
    if (status) conditions.push(eq(applications.status, status));
    if (cursor) {
      conditions.push(
        dir === "asc"
          ? or(
              gt(orderColumn, cursor.at),
              and(
                eq(orderColumn, cursor.at),
                gt(applications.id, cursor.id),
              ),
            )
          : or(
              lt(orderColumn, cursor.at),
              and(
                eq(orderColumn, cursor.at),
                lt(applications.id, cursor.id),
              ),
            ),
      );
    }

    const db = await getDb();
    const rows = await db
      .select()
      .from(applications)
      .where(and(...conditions))
      .orderBy(dir === "asc" ? asc(orderColumn) : desc(orderColumn), desc(applications.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last, sort) : null;

    return jsonOk({ items, nextCursor });
  } catch (error) {
    return errorResponse(error);
  }
}
