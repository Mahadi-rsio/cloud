/**
 * Project Discovery Engine
 *
 * Scans a local cloned repository and detects:
 *   - Deployable application directories
 *   - Frameworks, languages, runtimes, package managers
 *   - Monorepo and workspace structures
 *   - Multiple independent applications
 *
 * Uses @vercel/frameworks + @vercel/fs-detectors for JS/TS detection
 * plus custom deterministic detectors for other ecosystems.
 *
 * NEVER executes customer code. Reads files only.
 */

import path from "node:path";
import crypto from "node:crypto";
import { detectFrameworkForDir, findDockerfile } from "./framework-detection";
import { scanRepository } from "./scanner";
import { detectWorkspaces } from "./workspace-discovery";
import { isLikelyLibrary, rankCandidates, pickRecommendedRoot } from "./candidate-ranking";
import { detectRuntimeVersions } from "./runtime-detection";
import type { ProjectCandidate, RepositoryDiscoveryResult } from "./types";

export const DISCOVERY_VERSION = "1.0.0";

/**
 * Minimum conditions to consider a directory a deployable candidate.
 */
function hasDeployableSignal(files: string[]): boolean {
  const deployableFiles = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "Pipfile",
    "go.mod",
    "Cargo.toml",
    "composer.json",
    "artisan",
    "Gemfile",
    "mix.exs",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Dockerfile",
    "dockerfile",
    "Containerfile",
    "containerfile",
  ];
  return files.some((f) => deployableFiles.includes(f) || f.endsWith(".csproj") || f.endsWith(".sln"));
}

/**
 * Generate a stable deterministic ID for a candidate directory.
 */
function makeCandidateId(repoName: string, rootDir: string): string {
  return crypto
    .createHash("sha1")
    .update(`${repoName}:${rootDir}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Infer a human-readable display name for a candidate.
 * Prefer package.json `name`, else last path segment, else repo name.
 */
function inferCandidateName(repoName: string, rootDir: string): string {
  if (rootDir === ".") return repoName;
  const segments = rootDir.split("/");
  return segments[segments.length - 1];
}

export interface DiscoverProjectsOptions {
  repoRoot: string;
  repoName: string;
  branch: string;
  commitSha: string;
  maxDepth?: number;
  maxFiles?: number;
}

/**
 * Scan a cloned repository and return all discovered applications.
 */
export async function discoverProjects(
  options: DiscoverProjectsOptions,
): Promise<RepositoryDiscoveryResult> {
  const { repoRoot, repoName, branch, commitSha } = options;

  // Phase 1: Scan directory tree
  const scan = await scanRepository(repoRoot, {
    maxDepth: options.maxDepth ?? 5,
    maxFiles: options.maxFiles ?? 5000,
  });

  // Phase 2: Detect workspace / monorepo topology
  const workspaceInfo = await detectWorkspaces(repoRoot);

  // Phase 3: For each scanned directory with a deployable signal, detect framework
  const candidatePromises: Array<Promise<ProjectCandidate | null>> = [];

  for (const [relPath, dir] of scan.directories) {
    if (!hasDeployableSignal(dir.files)) continue;

    candidatePromises.push(
      (async (): Promise<ProjectCandidate | null> => {
        const warnings: string[] = [...scan.warnings];

        const detection = await detectFrameworkForDir(dir.absolutePath, dir.files);

        // Dockerfile path
        const dockerfileFile = findDockerfile(dir.files);
        const dockerfilePath = dockerfileFile
          ? relPath === "."
            ? dockerfileFile
            : `${relPath}/${dockerfileFile}`
          : undefined;

        // Runtime version hints
        const runtimeVersions = await detectRuntimeVersions(dir.absolutePath, dir.files);
        const detectedVersion =
          detection.detectedVersion ??
          runtimeVersions.nodeVersion ??
          runtimeVersions.pythonVersion ??
          runtimeVersions.goVersion ??
          runtimeVersions.rubyVersion ??
          runtimeVersions.rustVersion;

        const name = inferCandidateName(repoName, relPath);
        const id = makeCandidateId(repoName, relPath);

        // Library filter
        const likelyLib = isLikelyLibrary(relPath, dir.files, detection);
        const isDeployable = !likelyLib && (detection.confidence > 0.4 || !!dockerfileFile);

        // Boost confidence for root-level candidates that have a dockerfile
        let confidence = detection.confidence;
        if (!detection.framework && dockerfileFile) {
          confidence = 0.7;
        }

        return {
          id,
          name,
          rootDirectory: relPath,
          framework: detection.framework,
          frameworkName: detection.frameworkName,
          language: detection.language,
          runtime: detection.runtime,
          packageManager: detection.packageManager,
          detectedVersion,
          dockerfilePath,
          configFiles: detection.configFiles,
          confidence,
          warnings,
          isDeployable,
        };
      })(),
    );
  }

  const settled = await Promise.all(candidatePromises);
  const allCandidates = settled.filter((c): c is ProjectCandidate => c !== null);

  // Phase 4: Rank and select
  const ranked = rankCandidates(allCandidates);
  const { recommendedRootDirectory, requiresUserSelection } = pickRecommendedRoot(ranked);

  return {
    repository: { name: repoName, branch, commitSha },
    monorepo: workspaceInfo.isMonorepo,
    candidates: ranked,
    recommendedRootDirectory,
    requiresUserSelection,
    discoveryVersion: DISCOVERY_VERSION,
  };
}

// Re-export types and helpers
export type { ProjectCandidate, RepositoryDiscoveryResult };
export { normalizeRelativePath, validateSafePath } from "./path-validation";
