import { and, asc, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { findOwnedDeployment } from "@/lib/build/deployments-service";
import {
  formatSseComment,
  formatSseEvent,
  MAX_LOG_BATCH,
  parseLogCursor,
} from "@/lib/build/logs";
import { isTerminalStatus } from "@/lib/build/status";
import { getDb } from "@/lib/db";
import { deploymentLogs, deployments } from "@/lib/db/product-schema";
import { errorResponse } from "@/lib/http";
import { assertRateLimit, clientIp } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

// Workers cap the number of subrequests per invocation, so we stream in short
// windows and let EventSource transparently reconnect (sending Last-Event-ID).
const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MAX_STREAM_DURATION_MS = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  let id: string;
  try {
    await assertRateLimit(`rl:deployments:stream:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    id = z.uuid().parse((await ctx.params).id);
    await findOwnedDeployment(id, user.id);
  } catch (error) {
    return errorResponse(error);
  }

  const url = new URL(request.url);
  const initialCursor =
    parseLogCursor(request.headers.get("last-event-id")) ??
    parseLogCursor(url.searchParams.get("after")) ??
    0;

  const encoder = new TextEncoder();
  let cursor = initialCursor;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastStatus: string | null = null;
      let lastError: string | null = null;
      let lastPublicUrl: string | null = null;
      let lastHeartbeat = Date.now();
      const startedAt = Date.now();

      const send = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      try {
        send(formatSseComment("connected"));

        while (!closed) {
          if (request.signal.aborted) break;
          if (Date.now() - startedAt > MAX_STREAM_DURATION_MS) {
            send(formatSseComment("timeout"));
            break;
          }

          const db = await getDb();
          const rows = await db
            .select()
            .from(deploymentLogs)
            .where(
              and(
                eq(deploymentLogs.deploymentId, id),
                gt(deploymentLogs.id, cursor),
              ),
            )
            .orderBy(asc(deploymentLogs.id))
            .limit(MAX_LOG_BATCH);

          for (const row of rows) {
            cursor = row.id;
            const ok = send(
              formatSseEvent({
                id: row.id,
                event: "log",
                data: {
                  id: row.id,
                  stream: row.stream,
                  message: row.message,
                  timestamp: row.createdAt.toISOString(),
                },
              }),
            );
            if (!ok) break;
          }
          if (closed) break;

          const [current] = await db
            .select({
              status: deployments.status,
              errorMessage: deployments.errorMessage,
              publicUrl: deployments.publicUrl,
            })
            .from(deployments)
            .where(eq(deployments.id, id))
            .limit(1);

          if (current) {
            if (
              current.status !== lastStatus ||
              current.errorMessage !== lastError ||
              current.publicUrl !== lastPublicUrl
            ) {
              lastStatus = current.status;
              lastError = current.errorMessage;
              lastPublicUrl = current.publicUrl;
              send(
                formatSseEvent({
                  event: "status",
                  data: {
                    status: current.status,
                    errorMessage: current.errorMessage,
                    publicUrl: current.publicUrl,
                  },
                }),
              );
            }

            if (isTerminalStatus(current.status)) {
              send(
                formatSseEvent({
                  event: "complete",
                  data: {
                    status: current.status,
                    errorMessage: current.errorMessage,
                    publicUrl: current.publicUrl,
                  },
                }),
              );
              break;
            }
          }

          if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now();
            send(formatSseComment("ping"));
          }

          await sleep(POLL_INTERVAL_MS);
        }
      } catch (error) {
        send(
          formatSseEvent({
            event: "error",
            data: {
              message:
                error instanceof Error ? error.message : "The log stream failed.",
            },
          }),
        );
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}