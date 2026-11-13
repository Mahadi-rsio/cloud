import { apiV1 } from "@/lib/api-v1";
import type { GitHubRepoItem } from "@/app/api/v1/github/repos/route";

export type { GitHubRepoItem };

export interface GitHubConnectionResult {
  connected: boolean;
  username: string | null;
  repos: GitHubRepoItem[];
}

export async function getGitHubConnection(): Promise<GitHubConnectionResult> {
  const { data } = await apiV1.get<GitHubConnectionResult>("/github/repos");
  return data;
}

export async function connectGitHub(input: {
  token?: string;
  username?: string;
}): Promise<GitHubConnectionResult> {
  const { data } = await apiV1.post<GitHubConnectionResult>("/github/repos", input);
  return data;
}

export async function disconnectGitHub(): Promise<{ connected: boolean }> {
  const { data } = await apiV1.delete<{ connected: boolean }>("/github/repos");
  return data;
}
