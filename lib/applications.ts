import { apiV1 } from "@/lib/api-v1";
import type {
  CreateApplicationInput,
  UpdateApplicationInput,
} from "@/lib/validators/application";

export type ApplicationStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "failed"
  | "deleting"
  | "deleted";

export type MachineStatus =
  | "provisioning"
  | "running"
  | "stopped"
  | "stopping"
  | "starting"
  | "restarting"
  | "redeploying"
  | "failed"
  | "destroying"
  | "destroyed";

export interface RuntimeShape {
  image?: string;
  guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
  env?: Record<string, string>;
  internalPort?: number;
}

export interface Application {
  id: string;
  userId: string;
  name: string;
  slug: string;
  status: ApplicationStatus;
  region: string;
  runtime: RuntimeShape | null;
  requestedResources: Record<string, unknown> | null;
  lastOperationAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Machine {
  id: string;
  applicationId: string;
  flyMachineId: string | null;
  status: MachineStatus;
  region: string;
  instanceNumber: number;
  sharedIpv4: string | null;
  sharedIpv6: string | null;
  publicUrl: string | null;
  allocatedResources: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListApplicationsParams {
  cursor?: string | null;
  limit?: number;
  status?: ApplicationStatus;
  sort?: string;
}

function listQueryParams(params: ListApplicationsParams) {
  const query: Record<string, string> = {};
  if (params.cursor) query.cursor = params.cursor;
  if (params.limit) query.limit = String(params.limit);
  if (params.status) query["filter[status]"] = params.status;
  if (params.sort) query.sort = params.sort;
  return query;
}

export async function listApplications(
  params: ListApplicationsParams = {},
): Promise<{ items: Application[]; nextCursor: string | null }> {
  const { data } = await apiV1.get<{
    success: true;
    data: { items: Application[]; nextCursor: string | null };
  }>("/applications", { params: listQueryParams(params) });
  return data.data;
}

export async function getApplication(
  id: string,
): Promise<{ application: Application; machines: Machine[] }> {
  const { data } = await apiV1.get<{
    success: true;
    data: { application: Application; machines: Machine[] };
  }>(`/applications/${id}`);
  return data.data;
}

export async function createApplication(
  input: CreateApplicationInput,
): Promise<{ application: Application; machine: Machine }> {
  const { data } = await apiV1.post<{
    success: true;
    data: { application: Application; machine: Machine };
  }>("/applications", input);
  return data.data;
}

export async function updateApplication(
  id: string,
  input: UpdateApplicationInput,
): Promise<{ application: Application }> {
  const { data } = await apiV1.patch<{
    success: true;
    data: { application: Application };
  }>(`/applications/${id}`, input);
  return data.data;
}

export async function deleteApplication(
  id: string,
): Promise<{ application: Application }> {
  const { data } = await apiV1.delete<{
    success: true;
    data: { application: Application };
  }>(`/applications/${id}`);
  return data.data;
}

export interface MachineLogEntry {
  id?: string;
  timestamp: string;
  message: string;
  level?: "info" | "warn" | "error" | "debug" | "system";
  instance?: string;
  region?: string;
}

export async function getApplicationLogs(
  id: string,
  params?: { machineId?: string },
): Promise<{ logs: MachineLogEntry[]; machine: Machine | null }> {
  const { data } = await apiV1.get<{
    success: true;
    data: { logs: MachineLogEntry[]; machine: Machine | null };
  }>(`/applications/${id}/logs`, { params });
  return data.data;
}

export const FLY_REGIONS: { code: string; name: string }[] = [
  { code: "sin", name: "Singapore" },
  { code: "ams", name: "Amsterdam" },
  { code: "bos", name: "Boston" },
  { code: "cle", name: "Cleveland" },
  { code: "dfw", name: "Dallas" },
  { code: "ewr", name: "Newark" },
  { code: "fra", name: "Frankfurt" },
  { code: "gru", name: "São Paulo" },
  { code: "hkg", name: "Hong Kong" },
  { code: "iad", name: "Washington D.C." },
  { code: "jnb", name: "Johannesburg" },
  { code: "lax", name: "Los Angeles" },
  { code: "lhr", name: "London" },
  { code: "mad", name: "Madrid" },
  { code: "mia", name: "Miami" },
  { code: "nrt", name: "Tokyo" },
  { code: "ord", name: "Chicago" },
  { code: "scl", name: "Santiago" },
  { code: "sjc", name: "San Jose" },
  { code: "syd", name: "Sydney" },
  { code: "yyz", name: "Toronto" },
];
