import { formatSseComment, formatSseEvent } from "@/lib/build/logs";
import { isTerminalStatus } from "@/lib/build/status";

export const STALE_DEPLOYMENT_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;

export interface StreamLogRow {
  id: number;
  deploymentId: string;
  stream: string;
  message: string;
  createdAt: string | Date;
}

export interface StreamStatusPayload {
  status: string;
  errorMessage?: string | null;
  publicUrl?: string | null;
}

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  lastSentId: number;
  closed: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

/**
 * Durable Object that coordinates live SSE log streaming and event-driven
 * recovery alarms for a single deployment, eliminating 3-second Neon polling
 * and idle 5-minute recovery cron queries.
 */
export class DeploymentStreamDO {
  private ctx: any;
  private initialized = false;
  private subscribers = new Set<Subscriber>();
  private encoder = new TextEncoder();

  constructor(ctx: any, _env: any) {
    this.ctx = ctx;
  }

  private ensureSchema(): void {
    if (this.initialized) return;
    if (this.ctx?.storage?.sql) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS deployment_stream_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          deployment_id TEXT,
          status TEXT,
          error_message TEXT,
          public_url TEXT,
          last_log_id INTEGER NOT NULL DEFAULT 0,
          recovery_active INTEGER NOT NULL DEFAULT 0,
          recovery_deadline_ms INTEGER
        );
      `);
    }
    this.initialized = true;
  }

  private getState(): {
    deploymentId: string | null;
    status: string | null;
    errorMessage: string | null;
    publicUrl: string | null;
    lastLogId: number;
    recoveryActive: boolean;
    recoveryDeadlineMs: number | null;
  } {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) {
      return {
        deploymentId: null,
        status: null,
        errorMessage: null,
        publicUrl: null,
        lastLogId: 0,
        recoveryActive: false,
        recoveryDeadlineMs: null,
      };
    }
    const cursor = this.ctx.storage.sql.exec(
      "SELECT deployment_id, status, error_message, public_url, last_log_id, recovery_active, recovery_deadline_ms FROM deployment_stream_state WHERE id = 1",
    );
    for (const row of cursor) {
      return {
        deploymentId: row.deployment_id ? String(row.deployment_id) : null,
        status: row.status ? String(row.status) : null,
        errorMessage: row.error_message ? String(row.error_message) : null,
        publicUrl: row.public_url ? String(row.public_url) : null,
        lastLogId: Number(row.last_log_id ?? 0),
        recoveryActive: Number(row.recovery_active ?? 0) === 1,
        recoveryDeadlineMs:
          row.recovery_deadline_ms != null ? Number(row.recovery_deadline_ms) : null,
      };
    }
    return {
      deploymentId: null,
      status: null,
      errorMessage: null,
      publicUrl: null,
      lastLogId: 0,
      recoveryActive: false,
      recoveryDeadlineMs: null,
    };
  }

  private upsertState(patch: {
    deploymentId?: string | null;
    status?: string | null;
    errorMessage?: string | null;
    publicUrl?: string | null;
    lastLogId?: number;
    recoveryActive?: boolean;
    recoveryDeadlineMs?: number | null;
  }): void {
    this.ensureSchema();
    if (!this.ctx?.storage?.sql) return;
    const prev = this.getState();
    this.ctx.storage.sql.exec(
      `INSERT INTO deployment_stream_state
        (id, deployment_id, status, error_message, public_url, last_log_id, recovery_active, recovery_deadline_ms)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         deployment_id = excluded.deployment_id,
         status = excluded.status,
         error_message = excluded.error_message,
         public_url = excluded.public_url,
         last_log_id = excluded.last_log_id,
         recovery_active = excluded.recovery_active,
         recovery_deadline_ms = excluded.recovery_deadline_ms`,
      patch.deploymentId !== undefined ? patch.deploymentId : prev.deploymentId,
      patch.status !== undefined ? patch.status : prev.status,
      patch.errorMessage !== undefined ? patch.errorMessage : prev.errorMessage,
      patch.publicUrl !== undefined ? patch.publicUrl : prev.publicUrl,
      patch.lastLogId !== undefined ? patch.lastLogId : prev.lastLogId,
      (patch.recoveryActive !== undefined ? patch.recoveryActive : prev.recoveryActive) ? 1 : 0,
      patch.recoveryDeadlineMs !== undefined ? patch.recoveryDeadlineMs : prev.recoveryDeadlineMs,
    );
  }

  private closeSubscriber(sub: Subscriber): void {
    if (sub.closed) return;
    sub.closed = true;
    if (sub.heartbeatTimer) {
      clearInterval(sub.heartbeatTimer);
      sub.heartbeatTimer = undefined;
    }
    this.subscribers.delete(sub);
    try {
      sub.controller.close();
    } catch {
      // Already closed
    }
  }

  private sendToSubscriber(sub: Subscriber, chunk: string): boolean {
    if (sub.closed) return false;
    try {
      // Backpressure guard: drop slow consumer if queue is saturated
      if (sub.controller.desiredSize !== null && sub.controller.desiredSize <= -64) {
        this.closeSubscriber(sub);
        return false;
      }
      sub.controller.enqueue(this.encoder.encode(chunk));
      return true;
    } catch {
      this.closeSubscriber(sub);
      return false;
    }
  }

  private broadcast(chunk: string, minLogId?: number): void {
    for (const sub of [...this.subscribers]) {
      if (minLogId !== undefined) {
        if (minLogId <= sub.lastSentId) continue;
        if (this.sendToSubscriber(sub, chunk)) {
          sub.lastSentId = minLogId;
        }
      } else {
        this.sendToSubscriber(sub, chunk);
      }
    }
  }

  private async scheduleRecovery(
    deploymentId: string,
    staleAfterMs = STALE_DEPLOYMENT_MS,
  ): Promise<void> {
    const deadline = Date.now() + staleAfterMs;
    this.upsertState({
      deploymentId,
      recoveryActive: true,
      recoveryDeadlineMs: deadline,
    });
    if (this.ctx?.storage?.setAlarm) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  private async cancelRecovery(): Promise<void> {
    this.upsertState({
      recoveryActive: false,
      recoveryDeadlineMs: null,
    });
    if (this.ctx?.storage?.deleteAlarm) {
      await this.ctx.storage.deleteAlarm();
    }
  }

  async alarm(): Promise<void> {
    const state = this.getState();
    const deploymentId = state.deploymentId ?? (this.ctx?.id?.name as string | undefined);
    if (!state.recoveryActive || !deploymentId) return;

    try {
      const { recoverSingleDeployment } = await import("@/lib/build/recovery");
      const result = await recoverSingleDeployment(deploymentId);
      if (result.outcome === "reschedule" && result.nextDeadlineMs) {
        this.upsertState({
          recoveryActive: true,
          recoveryDeadlineMs: result.nextDeadlineMs,
        });
        if (this.ctx?.storage?.setAlarm) {
          await this.ctx.storage.setAlarm(result.nextDeadlineMs);
        }
      } else {
        await this.cancelRecovery();
        if (result.outcome === "recovered") {
          const payload: StreamStatusPayload = {
            status: "failed",
            errorMessage:
              "The build stopped responding and timed out. Please retry the deployment.",
          };
          this.broadcast(formatSseEvent({ event: "status", data: payload }));
          this.broadcast(formatSseEvent({ event: "done", data: payload }));
          for (const sub of [...this.subscribers]) {
            this.closeSubscriber(sub);
          }
        }
      }
    } catch {
      // Transient DB failure during alarm: retry in 60s
      const retryAt = Date.now() + 60_000;
      if (this.ctx?.storage?.setAlarm) {
        await this.ctx.storage.setAlarm(retryAt).catch(() => {});
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/subscribe" && request.method === "GET") {
      const afterParam = Number(url.searchParams.get("after") ?? "0");
      const initialCursor = Number.isFinite(afterParam) && afterParam > 0 ? afterParam : 0;
      const state = this.getState();

      let activeSub: Subscriber | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const sub: Subscriber = {
            controller,
            lastSentId: initialCursor,
            closed: false,
          };
          activeSub = sub;
          this.subscribers.add(sub);
          this.sendToSubscriber(sub, formatSseComment("connected"));

          if (state.status) {
            this.sendToSubscriber(
              sub,
              formatSseEvent({
                event: "status",
                data: {
                  status: state.status,
                  errorMessage: state.errorMessage,
                  publicUrl: state.publicUrl,
                },
              }),
            );
            if (isTerminalStatus(state.status)) {
              this.sendToSubscriber(
                sub,
                formatSseEvent({
                  event: "done",
                  data: {
                    status: state.status,
                    errorMessage: state.errorMessage,
                    publicUrl: state.publicUrl,
                  },
                }),
              );
              this.closeSubscriber(sub);
              return;
            }
          }

          sub.heartbeatTimer = setInterval(() => {
            this.sendToSubscriber(sub, formatSseComment("heartbeat"));
          }, HEARTBEAT_INTERVAL_MS);
        },
        cancel: () => {
          if (activeSub) {
            this.closeSubscriber(activeSub);
          }
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

    if (path === "/publish-logs" && request.method === "POST") {
      const body = (await request.json()) as {
        deploymentId: string;
        rows: StreamLogRow[];
      };
      let maxId = this.getState().lastLogId;
      for (const row of body.rows) {
        if (row.id > maxId) maxId = row.id;
        this.broadcast(
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
          row.id,
        );
      }
      this.upsertState({
        deploymentId: body.deploymentId,
        lastLogId: maxId,
      });
      return Response.json({ ok: true, subscribers: this.subscribers.size });
    }

    if (path === "/publish-status" && request.method === "POST") {
      const body = (await request.json()) as {
        deploymentId: string;
        status: string;
        errorMessage?: string | null;
        publicUrl?: string | null;
      };
      this.upsertState({
        deploymentId: body.deploymentId,
        status: body.status,
        errorMessage: body.errorMessage ?? null,
        publicUrl: body.publicUrl ?? null,
      });

      const payload: StreamStatusPayload = {
        status: body.status,
        errorMessage: body.errorMessage ?? null,
        publicUrl: body.publicUrl ?? null,
      };
      this.broadcast(formatSseEvent({ event: "status", data: payload }));

      if (isTerminalStatus(body.status)) {
        this.broadcast(formatSseEvent({ event: "done", data: payload }));
        for (const sub of [...this.subscribers]) {
          this.closeSubscriber(sub);
        }
        await this.cancelRecovery();
      } else {
        await this.scheduleRecovery(body.deploymentId);
      }

      return Response.json({ ok: true });
    }

    if (path === "/register-recovery" && request.method === "POST") {
      const body = (await request.json()) as {
        deploymentId: string;
        staleAfterMs?: number;
      };
      await this.scheduleRecovery(
        body.deploymentId,
        body.staleAfterMs ?? STALE_DEPLOYMENT_MS,
      );
      return Response.json({ ok: true });
    }

    if (path === "/cancel-recovery" && request.method === "POST") {
      await this.cancelRecovery();
      return Response.json({ ok: true });
    }

    return new Response("Not Found", { status: 404 });
  }
}

export async function getDeploymentStreamStub(deploymentId: string): Promise<any | null> {
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return null;
  }
  try {
    const { env } = await import("cloudflare:workers");
    const ns = (env as unknown as Record<string, any>)?.DEPLOYMENT_STREAM;
    if (ns && typeof ns.idFromName === "function") {
      return ns.get(ns.idFromName(deploymentId));
    }
  } catch {
    // Outside Cloudflare Workers runtime
  }
  return null;
}

export async function notifyDeploymentLogs(
  deploymentId: string,
  rows: StreamLogRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const stub = await getDeploymentStreamStub(deploymentId);
  if (!stub) return;
  await stub
    .fetch("https://stream.internal/publish-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deploymentId, rows }),
    })
    .catch(() => {});
}

export async function notifyDeploymentStatus(
  deploymentId: string,
  payload: StreamStatusPayload,
): Promise<void> {
  const stub = await getDeploymentStreamStub(deploymentId);
  if (!stub) return;
  await stub
    .fetch("https://stream.internal/publish-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deploymentId, ...payload }),
    })
    .catch(() => {});
}

export async function registerDeploymentRecovery(
  deploymentId: string,
  staleAfterMs = STALE_DEPLOYMENT_MS,
): Promise<void> {
  const stub = await getDeploymentStreamStub(deploymentId);
  if (!stub) return;
  await stub
    .fetch("https://stream.internal/register-recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deploymentId, staleAfterMs }),
    })
    .catch(() => {});
}
