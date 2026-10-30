export interface ProjectCandidate {
  id: string;
  name: string;
  rootDirectory: string;
  framework: string | null;
  frameworkName: string | null;
  language: string | null;
  runtime: string | null;
  packageManager: string | null;
  packageManagerVersion?: string;
  detectedVersion?: string;
  dockerfilePath?: string;
  configFiles: string[];
  confidence: number;
  warnings: string[];
  isDeployable: boolean;
}

export interface RepositoryDiscoveryResult {
  repository: {
    name: string;
    branch: string;
    commitSha: string;
  };
  monorepo: boolean;
  candidates: ProjectCandidate[];
  recommendedRootDirectory: string | null;
  requiresUserSelection: boolean;
  discoveryVersion: string;
}

export interface WorkspaceInfo {
  type: "npm" | "pnpm" | "yarn" | "turbo" | "nx" | "lerna" | "cargo" | "go" | "python" | "unknown";
  configFile: string;
  packages: string[];
}

export interface RawFileEntry {
  name: string;
  path: string; // relative to repo root
  isDirectory: boolean;
  size: number;
}
