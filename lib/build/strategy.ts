/**
 * Build strategy detection.
 *
 * Railpack is the default zero-config builder. When a repository ships a
 * Dockerfile (or Containerfile) at its root we honour it instead, so existing
 * containerized projects build exactly as their author intended.
 */

export type BuildStrategy = "railpack" | "dockerfile";

const DOCKERFILE_NAMES = new Set(["dockerfile", "containerfile"]);

/** The Dockerfile we should use, if any, from a repo's root file listing. */
export function findDockerfile(fileNames: readonly string[]): string | null {
  for (const name of fileNames) {
    if (DOCKERFILE_NAMES.has(name.toLowerCase())) return name;
  }
  return null;
}

export function detectBuildStrategy(
  fileNames: readonly string[],
): { strategy: BuildStrategy; dockerfile: string | null } {
  const dockerfile = findDockerfile(fileNames);
  return dockerfile
    ? { strategy: "dockerfile", dockerfile }
    : { strategy: "railpack", dockerfile: null };
}