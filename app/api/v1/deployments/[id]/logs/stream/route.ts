import { and, asc, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { getDeploymentStreamStub } from "@/lib/build/deployment-stream-do";
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

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_STREAM_DURATION_MS = 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  let id: string;
  let deployment: Awaited<ReturnType<typeof findOwnedDeployment>>;
  try {
    await assertRateLimit(`rl:deployments:stream:${clientIp(request)}`, {
      limit: 120,
      windowSeconds: 60,
    });
    const user = await requireUser();
    id = z.uuid().parse((await ctx.params).id);
    deployment = await findOwnedDeployment(id, user.id);
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

  // Fetch historical logs once from Neon before subscribing to live DO events
  const db = await getDb();
  const historicalRows = await db
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

  const lastHistoricalId =
    historicalRows.length > 0
      ? historicalRows[historicalRows.length - 1]!.id
      : cursor;

  // If deployment is already terminal, emit historical logs + done and close immediately (0 polling)
  if (isTerminalStatus(deployment.status)) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(formatSseComment("connected")));
        for (const row of historicalRows) {
          controller.enqueue(
            encoder.encode(
              formatSseEvent({
                id: row.id,
                event: "log",
                data: {
                  id: row.id,
                  stream: row.stream,
                  message: row.message,
                  createdAt: row.createdAt,
                },
              }),
            ),
          );
        }
        const statusPayload = {
          status: deployment.status,
          errorMessage: deployment.errorMessage,
          publicUrl: deployment.publicUrl,
        };
        controller.enqueue(
          encoder.encode(formatSseEvent({ event: "status", data: statusPayload })),
        );
        controller.enqueue(
          encoder.encode(formatSseEvent({ event: "done", data: statusPayload })),
        );
        controller.close();
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Prefer Durable Object live push stream (0 Neon polling!)
  const streamStub = await getDeploymentStreamStub(id);
  if (streamStub) {
    const doResponse: Response = await streamStub.fetch(
      `https://stream.internal/subscribe?after=${lastHistoricalId}`,
      { method: "GET" },
    );

    if (doResponse.ok && doResponse.body) {
      const doReader = doResponse.body.getReader();
      const combined = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const row of historicalRows) {
            controller.enqueue(
              encoder.encode(
                formatSseEvent({
                  id: row.id,
                  event: "log",
                  data: {
                    id: row.id,
                    stream: row.stream,
                    message: row.message,
                    createdAt: row.createdAt,
                  },
                }),
              ),
            );
          }
          controller.enqueue(
            encoder.encode(
              formatSseEvent({
                event: "status",
                data: {
                  status: deployment.status,
                  errorMessage: deployment.errorMessage,
                  publicUrl: deployment.publicUrl,
                },
              }),
            ),
          );

          try {
            while (true) {
              if (request.signal.aborted) break;
              const { value, done } = await doReader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } catch {
            // Stream closed or aborted
          } finally {
            await doReader.cancel().catch(() => {});
            try {
              controller.close();
            } catch {
              // Already closed
            }
          }
        },
        cancel() {
          doReader.cancel().catch(() => {});
        },
      });

      return new Response(combined, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
  }

  // Local dev fallback when DEPLOYMENT_STREAM DO binding is unavailable
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastStatus: string | null = deployment.status;
      let lastError: string | null = deployment.errorMessage ?? null;
      let lastPublicUrl: string | null = deployment.publicUrl ?? null;
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
        for (const row of historicalRows) {
          cursor = row.id;
          if (
            !send(
              formatSseEvent({
                id: row.id,
                event: "log",
                data: {
                  id: row.id,
                  stream: row.stream,
                  message: row.message,
                  createdAt: row.createdAt,
                },
              }),
            )
          ) {
            return;
          }
        }
        send(
          formatSseEvent({
            event: "status",
            data: {
              status: lastStatus,
              errorMessage: lastError,
              publicUrl: lastPublicUrl,
            },
          }),
        );

        while (!closed) {
          if (request.signal.aborted) break;
          if (Date.now() - startedAt > MAX_STREAM_DURATION_MS) {
            send(formatSseComment("timeout"));
            break;
          }

          await sleep(FALLBACK_POLL_INTERVAL_MS);
          if (closed || request.signal.aborted) break;

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
            if (
              !send(
                formatSseEvent({
                  id: row.id,
                  event: "log",
                  data: {
                    id: row.id,
                    stream: row.stream,
                    message: row.message,
                    createdAt: row.createdAt,
                  },
                }),
              )
            ) {
              return;
            }
          }

          const [current] = await db
            .select({
              status: deployments.status,
              errorMessage: deployments.errorMessage,
              publicUrl: deployments.publicUrl,
            })
            .from(deployments)
            .where(eq(deployments.id, id))
            .limit(1);

          if (!current) {
            send(formatSseEvent({ event: "done", data: { status: "deleted" } }));
            break;
          }

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
                event: "done",
                data: {
                  status: current.status,
                  errorMessage: current.errorMessage,
                  publicUrl: current.publicUrl,
                },
              }),
            );
            break;
          }

          if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            lastHeartbeat = Date.now();
            send(formatSseComment("heartbeat"));
          }
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed
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
