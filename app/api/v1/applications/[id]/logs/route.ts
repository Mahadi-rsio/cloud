import { and, desc, eq, ne } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { assertOwnership, requireUser } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { applications, machines } from "@/lib/db/product-schema";
import { getFlyLogs, getFlyMachine, type FlyLogMessage } from "@/lib/fly/client";
import { errorResponse, HttpError, jsonOk } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

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
    await assertRateLimit(`rl:applications:logs:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    const id = z.uuid().parse((await ctx.params).id);
    const { db, application } = await findOwnedApplication(id, user.id);

    const searchParams = request.nextUrl.searchParams;
    const requestedMachineId = searchParams.get("machineId");

    const machineRows = await db
      .select()
      .from(machines)
      .where(
        requestedMachineId
          ? and(eq(machines.applicationId, id), eq(machines.id, requestedMachineId))
          : and(eq(machines.applicationId, id), ne(machines.status, "destroyed")),
      )
      .orderBy(desc(machines.createdAt));

    const machine = machineRows[0];

    const logs: FlyLogMessage[] = [];

    // 1. Fetch live container stdout/stderr logs from Fly Logs API
    if (machine?.flyMachineId) {
      try {
        const flyLogs = await getFlyLogs(application.slug, {
          instance: machine.flyMachineId,
          region: machine.region,
        });
        logs.push(...flyLogs);
      } catch {
        // Fallback silently if logs service is unavailable
      }
    }

    // 2. Fetch machine lifecycle events from Fly Machines API
    if (machine?.flyMachineId) {
      try {
        const flyMachine = await getFlyMachine(application.slug, machine.flyMachineId);
        if (Array.isArray(flyMachine?.events)) {
          for (const evt of flyMachine.events) {
            const timeStr = evt.timestamp
              ? new Date(evt.timestamp).toISOString()
              : machine.createdAt.toISOString();
            const isError = evt.status === "failed" || evt.type === "exit_with_error";
            logs.push({
              id: evt.id ?? `evt-${evt.timestamp}-${evt.type}`,
              timestamp: timeStr,
              message: `[machine-event] Type: ${evt.type} | Status: ${evt.status}${evt.source ? ` | Source: ${evt.source}` : ""}`,
              level: isError ? "error" : "system",
              instance: machine.flyMachineId,
              region: machine.region,
            });
          }
        }
      } catch {
        // Fallback silently if machine inspect fails
      }
    }

    // 3. Machine error if recorded in database
    if (machine?.error) {
      logs.push({
        id: `err-${machine.id}`,
        timestamp: machine.updatedAt.toISOString(),
        message: `[machine-error] ${JSON.stringify(machine.error)}`,
        level: "error",
        instance: machine.flyMachineId ?? machine.id,
        region: machine.region,
      });
    }

    // 4. Synthesize machine lifecycle events if no logs are present yet
    if (logs.length === 0 && machine) {
      const runtime = application.runtime as { image?: string; internalPort?: number; guest?: { cpus?: number; memory_mb?: number } } | null;
      logs.push({
        id: `sys-1-${machine.id}`,
        timestamp: machine.createdAt.toISOString(),
        message: `[system] MicroVM instance initialized in region ${machine.region.toUpperCase()}.`,
        level: "system",
        instance: machine.flyMachineId ?? machine.id,
        region: machine.region,
      });

      if (machine.sharedIpv4) {
        logs.push({
          id: `sys-2-${machine.id}`,
          timestamp: new Date(machine.createdAt.getTime() + 500).toISOString(),
          message: `[system] Anycast routing established on public IP: ${machine.sharedIpv4} (https://${application.slug}.fly.dev)`,
          level: "info",
          instance: machine.flyMachineId ?? machine.id,
          region: machine.region,
        });
      }

      if (runtime?.image) {
        logs.push({
          id: `sys-3-${machine.id}`,
          timestamp: new Date(machine.createdAt.getTime() + 1000).toISOString(),
          message: `[system] Pulling container image: ${runtime.image}`,
          level: "info",
          instance: machine.flyMachineId ?? machine.id,
          region: machine.region,
        });
      }

      logs.push({
        id: `sys-4-${machine.id}`,
        timestamp: machine.updatedAt.toISOString(),
        message: `[system] MicroVM state changed to: ${machine.status.toUpperCase()} (instance #${machine.instanceNumber + 1})`,
        level: machine.status === "failed" ? "error" : "info",
        instance: machine.flyMachineId ?? machine.id,
        region: machine.region,
      });
    }

    // Sort chronologically ascending
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return jsonOk({ logs, machine: machine ?? null });
  } catch (error) {
    return errorResponse(error);
  }
}
