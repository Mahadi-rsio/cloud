/**
 * Helpers for the deployment log stream.
 *
 * Logs live in Postgres (`deployment_logs`) and are addressed by a monotonic
 * `bigserial` id. That id doubles as the SSE event id, which lets a client
 * resume exactly where it left off via the `Last-Event-ID` header (or the
 * `?after=` query parameter used for the very first connection).
 */

export type DeploymentLogStream = "stdout" | "stderr" | "system";

export const LOG_STREAMS: readonly DeploymentLogStream[] = [
  "stdout",
  "stderr",
  "system",
];

export const MAX_LOG_MESSAGE_LENGTH = 20_000;
export const MAX_LOG_BATCH = 500;

export function isDeploymentLogStream(value: unknown): value is DeploymentLogStream {
  return value === "stdout" || value === "stderr" || value === "system";
}

/** Parse a Last-Event-ID / after cursor. Returns null for "from the start". */
export function parseLogCursor(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const cursor = Number(trimmed);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

/** Format one SSE frame. Multi-line data is split into `data:` lines. */
export function formatSseEvent(input: {
  event: string;
  data: unknown;
  id?: number | string | null;
}): string {
  const lines: string[] = [];
  if (input.id !== undefined && input.id !== null) {
    lines.push(`id: ${input.id}`);
  }
  lines.push(`event: ${input.event}`);
  const payload =
    typeof input.data === "string" ? input.data : JSON.stringify(input.data);
  for (const line of payload.split("\n")) {
    lines.push(`data: ${line}`);
  }
  return `${lines.join("\n")}\n\n`;
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`;
}

/** Split a raw chunk into complete log lines, keeping a trailing partial. */
export function splitLogChunk(buffer: string): {
  lines: string[];
  remainder: string;
} {
  const parts = buffer.split(/\r?\n/);
  const remainder = parts.pop() ?? "";
  return { lines: parts, remainder };
}

/** Clamp an untrusted log message before it is persisted. */
export function normalizeLogMessage(message: string): string {
  const trimmed = message.replace(/\u0000/g, "").slice(0, MAX_LOG_MESSAGE_LENGTH);
  return trimmed.length === 0 ? "(empty line)" : trimmed;
}