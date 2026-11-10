import type {
  StudioQueryResult,
  StudioRowsResult,
  StudioSchema,
  StudioSortDir,
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
  rows: (input: {
    table: string;
    page: number;
    pageSize: number;
    sortColumn?: string;
    sortDir?: StudioSortDir;
  }) => call<StudioRowsResult>({ action: "rows", ...input }),
  query: (input: { sql: string; allowWrite: boolean }) =>
    call<StudioQueryResult>({ action: "query", ...input }),
};