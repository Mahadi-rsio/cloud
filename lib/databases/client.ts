import { apiV1 } from "@/lib/api-v1";
import type { CreateDatabaseInput } from "@/lib/validators/database";

export interface DatabaseItem {
  id: string;
  userId: string;
  name: string;
  namespace: string;
  region: string;
  status: "provisioning" | "ready" | "failed" | "deleting" | "deleted";
  source: "user" | "auth";
  primaryHost: string;
  httpUrl: string;
  libsqlUrl: string;
  defaultToken: string;
  createdAt: string;
  updatedAt: string;
  stats?: {
    rowsReadCount?: number;
    rowsWrittenCount?: number;
    storageBytesUsed?: number;
    queryCount?: number;
  } | null;
}

export async function listDatabases(): Promise<DatabaseItem[]> {
  const { data } = await apiV1.get<{
    success: boolean;
    data: DatabaseItem[];
  }>("/databases");
  return data.data;
}

export async function getDatabase(id: string): Promise<DatabaseItem> {
  const { data } = await apiV1.get<{
    success: boolean;
    data: DatabaseItem;
  }>(`/databases/${id}`);
  return data.data;
}

export async function createDatabase(
  input: CreateDatabaseInput,
): Promise<DatabaseItem> {
  const { data } = await apiV1.post<{
    success: boolean;
    data: DatabaseItem;
  }>("/databases", input);
  return data.data;
}

export async function deleteDatabase(
  id: string,
): Promise<{ success: boolean; id: string; namespace: string }> {
  const { data } = await apiV1.delete<{
    success: boolean;
    data: { success: boolean; id: string; namespace: string };
  }>(`/databases/${id}`);
  return data.data;
}
