import { createStudioClient, type StudioConnection } from "@/lib/studio-db";
import type { Client } from "@libsql/client";
import { HttpError } from "@/lib/http";
import type {
  StudioCellValue,
  StudioColumn,
  StudioQueryResult,
  StudioRowsResult,
  StudioSchema,
  StudioTableInfo,
} from "@/lib/studio/types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MAX_QUERY_ROWS = 1000;
const QUERY_TIMEOUT_MS = 10_000;

const WRITE_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|REINDEX|VACUUM)\b/i;

function quoteId(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function serializeCell(value: unknown): StudioCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  // ArrayBuffer / typed-array (SQLite blobs)
  if (typeof ArrayBuffer !== "undefined") {
    if (value instanceof ArrayBuffer) {
      return toHex(new Uint8Array(value));
    }
    if (ArrayBuffer.isView(value)) {
      return toHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
  }
  return String(value);
}

function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new HttpError("PROVIDER_ERROR", `Query timed out after ${ms / 1000}s.`, 504));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function listTableColumns(client: Client, table: string): Promise<StudioColumn[]> {
  const result = await client.execute(`PRAGMA table_info(${quoteId(table)})`);
  return result.rows.map((row) => ({
    name: String(row.name ?? ""),
    type: String(row.type ?? ""),
    notNull: Boolean(row.notnull),
    pk: Number(row.pk ?? 0) > 0,
  }));
}

async function listTables(connection: StudioConnection): Promise<StudioTableInfo[]> {
  const client = await createStudioClient(connection);
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const names = result.rows.map((row) => String(row.name));
  const infos: StudioTableInfo[] = [];
  for (const name of names) {
    const columns = await listTableColumns(client, name);
    infos.push({ name, columnCount: columns.length });
  }
  return infos;
}

async function getSchema(connection: StudioConnection): Promise<StudioSchema> {
  const client = await createStudioClient(connection);
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const names = result.rows.map((row) => String(row.name));
  const schema: StudioSchema = {};
  for (const name of names) {
    schema[name] = await listTableColumns(client, name);
  }
  return schema;
}

interface GetRowsInput {
  table: string;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDir?: "asc" | "desc";
}

async function getRows(connection: StudioConnection, input: GetRowsInput): Promise<StudioRowsResult> {
  const client = await createStudioClient(connection);
  const table = input.table.trim();

  const columns = await listTableColumns(client, table);
  if (columns.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }

  const page = Math.max(0, Math.floor(input.page) || 0);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize) || DEFAULT_PAGE_SIZE));

  const validColumn = columns.some((c) => c.name === input.sortColumn);
  const orderBy =
    validColumn && input.sortColumn
      ? ` ORDER BY ${quoteId(input.sortColumn)} ${input.sortDir === "desc" ? "DESC" : "ASC"}`
      : "";

  const countResult = await withTimeout(
    client.execute({ sql: `SELECT COUNT(*) AS c FROM ${quoteId(table)}`, args: [] }),
    QUERY_TIMEOUT_MS,
  );
  const total = Number(countResult.rows[0]?.c ?? 0);

  const rowsResult = await withTimeout(
    client.execute({
      sql: `SELECT * FROM ${quoteId(table)}${orderBy} LIMIT ? OFFSET ?`,
      args: [pageSize, page * pageSize],
    }),
    QUERY_TIMEOUT_MS,
  );

  const names = rowsResult.columns;
  const rows = rowsResult.rows.map((row) => names.map((name) => serializeCell(row[name])));

  return { columns: names, rows, total, page, pageSize };
}

interface RunQueryInput {
  sql: string;
  allowWrite: boolean;
}

async function runQuery(connection: StudioConnection, input: RunQueryInput): Promise<StudioQueryResult> {
  const client = await createStudioClient(connection);
  const sql = input.sql.trim();

  if (!sql) {
    throw new HttpError("VALIDATION_ERROR", "Query cannot be empty.", 400);
  }

  if (!input.allowWrite && WRITE_RE.test(sql)) {
    throw new HttpError(
      "FORBIDDEN",
      "Write queries are disabled. Enable 'Allow writes' to run this statement.",
      403,
    );
  }

  const started = performance.now();
  const result = await withTimeout(client.execute(sql), QUERY_TIMEOUT_MS);
  const durationMs = Math.max(0, Math.round(performance.now() - started));

  const names = result.columns ?? [];
  const allRows = (result.rows ?? []).map((row) =>
    names.map((name) => serializeCell(row[name])),
  );
  const truncated = allRows.length > MAX_QUERY_ROWS;
  const rows = allRows.slice(0, MAX_QUERY_ROWS);

  return {
    columns: names,
    rows,
    rowsAffected: typeof result.rowsAffected === "number" ? result.rowsAffected : null,
    durationMs,
    truncated,
  };
}

export const studioService = {
  listTables,
  getSchema,
  getRows,
  runQuery,
};