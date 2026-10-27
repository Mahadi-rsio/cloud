import { apiV1 } from "@/lib/api-v1";
import type {
  CreateDeploymentInput,
  ValidateDeploymentInput,
} from "@/lib/validators/deployment";

export type DeploymentStatus =
  | "queued"
  | "preparing"
  | "building"
  | "pushing"
  | "deploying"
  | "active"
  | "failed"
  | "cancelled";

export interface Deployment {
  id: string;
  userId: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  commitSha: string | null;
  status: DeploymentStatus;
  errorMessage: string | null;
  imageRef: string | null;
  flyAppId: string | null;
  flyMachineId: string | null;
  publicUrl: string | null;
  buildNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLogEntry {
  id: number;
  stream: "stdout" | "stderr" | "system";
  message: string;
  timestamp: string;
}

export interface ValidatedRepository {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  fork: boolean;
  pushedAt: string | null;
}

export type ValidateDeploymentResult =
  | { valid: true; repository: ValidatedRepository }
  | { valid: false; reason: string; message: string };

export const TERMINAL_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  "active",
  "failed",
  "cancelled",
];

export function isTerminalDeploymentStatus(status: string): boolean {
  return TERMINAL_DEPLOYMENT_STATUSES.includes(status as DeploymentStatus);
}

export async function listDeployments(params: {
  cursor?: string | null;
  limit?: number;
} = {}): Promise<{ items: Deployment[]; nextCursor: string | null }> {
  const { data } = await apiV1.get<{
    success: true;
    data: { items: Deployment[]; nextCursor: string | null };
  }>("/deployments", {
    params: {
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit ? { limit: String(params.limit) } : {}),
    },
  });
  return data.data;
}

export async function getDeployment(id: string): Promise<Deployment> {
  const { data } = await apiV1.get<{
    success: true;
    data: { deployment: Deployment };
  }>(`/deployments/${id}`);
  return data.data.deployment;
}

export async function createDeployment(
  input: CreateDeploymentInput,
): Promise<Deployment> {
  const { data } = await apiV1.post<{
    success: true;
    data: { deployment: Deployment };
  }>("/deployments", input);
  return data.data.deployment;
}

export async function validateDeployment(
  input: ValidateDeploymentInput,
): Promise<ValidateDeploymentResult> {
  const { data } = await apiV1.post<{
    success: true;
    data: ValidateDeploymentResult;
  }>("/deployments/validate", input);
  return data.data;
}

export async function retryDeployment(id: string): Promise<Deployment> {
  const { data } = await apiV1.post<{
    success: true;
    data: { deployment: Deployment };
  }>(`/deployments/${id}/retry`);
  return data.data.deployment;
}

export async function getDeploymentLogs(
  id: string,
  params: { after?: number; limit?: number } = {},
): Promise<{
  items: DeploymentLogEntry[];
  nextCursor: number;
  status: DeploymentStatus;
  terminal: boolean;
}> {
  const { data } = await apiV1.get<{
    success: true;
    data: {
      items: DeploymentLogEntry[];
      nextCursor: number;
      status: DeploymentStatus;
      terminal: boolean;
    };
  }>(`/deployments/${id}/logs`, {
    params: {
      ...(params.after !== undefined ? { after: String(params.after) } : {}),
      ...(params.limit ? { limit: String(params.limit) } : {}),
    },
  });
  return data.data;
}