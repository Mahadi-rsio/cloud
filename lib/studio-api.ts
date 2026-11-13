import type {
  CreateColumnInput,
  CreateTableInput,
  StudioCellValue,
  StudioFilterCondition,
  StudioQueryResult,
  StudioRowsResult,
  StudioSchema,
  StudioSortDir,
  StudioTableDetails,
  StudioTableInfo,
} from "@/lib/studio/types";
import { useStudioConnectionStore } from "@/stores/studio-connection";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

function currentConnection() {
  const { databaseId } = useStudioConnectionStore.getState();
  if (!databaseId) {
    throw new Error("Connect to a database first.");
  }
  return { databaseId };
}

async function call<T>(body: unknown): Promise<T> {
  const requestBody = { connection: currentConnection(), ...(body as object) };
  const response = await fetch("/api/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  let payload: ApiEnvelope<T> | undefined;
  try {
    payload = (await response.json()) as ApiEnvelope<T>;
  } catch {
    payload = undefined;
  }

  if (!response.ok || !payload?.success || payload.data === undefined) {
    const message = payload?.error?.message ?? `Request failed (${response.status}).`;
    const detail =
      typeof payload?.error?.details === "object" &&
      payload.error.details !== null &&
      "url" in (payload.error.details as object)
        ? ` (${String((payload.error.details as { url: unknown }).url)})`
        : "";
    throw new Error(`${message}${detail}`);
  }
  return payload.data;
}

export const studioApi = {
  tables: () => call<StudioTableInfo[]>({ action: "tables" }),
  schema: () => call<StudioSchema>({ action: "schema" }),
  tableDetails: (table: string) =>
    call<StudioTableDetails>({ action: "table_details", table }),
  rows: (input: {
    table: string;
    page: number;
    pageSize: number;
    sortColumn?: string;
    sortDir?: StudioSortDir;
    filters?: StudioFilterCondition[];
    search?: string;
  }) => call<StudioRowsResult>({ action: "rows", ...input }),
  insertRow: (input: { table: string; row: Record<string, StudioCellValue> }) =>
    call<{ rowsAffected: number; lastInsertRowid: string | null }>({
      action: "insert_row",
      ...input,
    }),
  updateRow: (input: {
    table: string;
    identity: Record<string, StudioCellValue>;
    changes: Record<string, StudioCellValue>;
  }) =>
    call<{ rowsAffected: number }>({
      action: "update_row",
      ...input,
    }),
  deleteRows: (input: {
    table: string;
    identities: Array<Record<string, StudioCellValue>>;
  }) =>
    call<{ rowsAffected: number }>({
      action: "delete_rows",
      ...input,
    }),
  createTable: (input: CreateTableInput) =>
    call<{ table: string; sql: string }>({
      action: "create_table",
      ...input,
    }),
  dropTable: (table: string) =>
    call<{ table: string }>({
      action: "drop_table",
      table,
    }),
  truncateTable: (table: string) =>
    call<{ table: string; rowsAffected: number }>({
      action: "truncate_table",
      table,
    }),
  addColumn: (input: { table: string; column: CreateColumnInput }) =>
    call<{ table: string; column: string; sql: string }>({
      action: "add_column",
      ...input,
    }),
  dropColumn: (input: { table: string; column: string }) =>
    call<{ table: string; column: string }>({
      action: "drop_column",
      ...input,
    }),
  renameTable: (input: { table: string; newName: string }) =>
    call<{ oldName: string; newName: string }>({
      action: "rename_table",
      ...input,
    }),
  query: (input: { sql: string; allowWrite: boolean }) =>
    call<StudioQueryResult>({ action: "query", ...input }),
};
