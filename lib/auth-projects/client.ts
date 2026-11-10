import { apiV1 } from "@/lib/api-v1";
import type { CreateAuthProjectInput } from "@/lib/validators/auth-project";

export interface AuthProjectItem {
  id: string;
  userId: string;
  name: string;
  namespace: string;
  status: "provisioning" | "ready" | "failed" | "deleting" | "deleted";
  primaryHost: string;
  httpUrl: string;
  libsqlUrl: string;
  publishableKey: string;
  linkedDatabaseId: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: {
    rowsReadCount?: number;
    rowsWrittenCount?: number;
    storageBytesUsed?: number;
    queryCount?: number;
  } | null;
}

export function authRuntimeUrl(): string {
  if (typeof window === "undefined") return "/api/auth-runtime";
  return `${window.location.origin}/api/auth-runtime`;
}

export async function listAuthProjects(): Promise<AuthProjectItem[]> {
  const { data } = await apiV1.get<{
    success: boolean;
    data: AuthProjectItem[];
  }>("/auth/projects");
  return data.data;
}

export async function createAuthProject(
  input: CreateAuthProjectInput,
): Promise<AuthProjectItem> {
  const { data } = await apiV1.post<{
    success: boolean;
    data: AuthProjectItem;
  }>("/auth/projects", input);
  return data.data;
}

export async function deleteAuthProject(
  id: string,
): Promise<{ success: boolean; id: string; namespace: string }> {
  const { data } = await apiV1.delete<{
    success: boolean;
    data: { success: boolean; id: string; namespace: string };
  }>(`/auth/projects/${id}`);
  return data.data;
}
