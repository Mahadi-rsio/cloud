import type { ProjectCandidate } from "./types";

/**
 * Heuristic: is a directory likely a shared package / library rather than a
 * deployable application?  Used to filter candidates that should not be shown
 * to the user as standalone deployment targets.
 */
export function isLikelyLibrary(dirRelativePath: string, files: string[], candidate: Pick<ProjectCandidate, "framework" | "frameworkName" | "confidence">): boolean {
  const lower = dirRelativePath.toLowerCase();

  // Directories named like shared packages are library hints
  const libraryDirNames = ["packages", "libs", "shared", "common", "ui", "components", "utils", "helpers", "types"];
  const lastSegment = lower.split("/").at(-1) ?? "";
  if (libraryDirNames.includes(lastSegment)) {
    // But only if there's no strong framework evidence
    if ((candidate.confidence ?? 0) < 0.7 || !candidate.framework) return true;
  }

  // If path is nested under packages/ or libs/
  if (lower.startsWith("packages/") || lower.startsWith("libs/") || lower.startsWith("shared/")) {
    if ((candidate.confidence ?? 0) < 0.8 || !candidate.framework) return true;
  }

  return false;
}

/**
 * Rank and deduplicate candidates by confidence, then by path depth (shallower first).
 */
export function rankCandidates(candidates: ProjectCandidate[]): ProjectCandidate[] {
  // Filter out library stubs with no framework at very low confidence
  const deployable = candidates.filter((c) => c.isDeployable);
  const nonDeployable = candidates.filter((c) => !c.isDeployable);

  const sorted = deployable.sort((a, b) => {
    // Higher confidence first
    const confidenceDiff = b.confidence - a.confidence;
    if (Math.abs(confidenceDiff) > 0.05) return confidenceDiff;

    // Shallower paths first
    const aDepth = a.rootDirectory === "." ? 0 : a.rootDirectory.split("/").length;
    const bDepth = b.rootDirectory === "." ? 0 : b.rootDirectory.split("/").length;
    return aDepth - bDepth;
  });

  return [...sorted, ...nonDeployable];
}

/**
 * Select a recommended root directory from a ranked list of candidates.
 * - If exactly one deployable candidate: use it
 * - If the highest-confidence is significantly better: use it
 * - Otherwise: null (user must select)
 */
export function pickRecommendedRoot(candidates: ProjectCandidate[]): {
  recommendedRootDirectory: string | null;
  requiresUserSelection: boolean;
} {
  const deployable = candidates.filter((c) => c.isDeployable);

  if (deployable.length === 0) {
    return { recommendedRootDirectory: null, requiresUserSelection: false };
  }

  if (deployable.length === 1) {
    return {
      recommendedRootDirectory: deployable[0].rootDirectory,
      requiresUserSelection: false,
    };
  }

  // Multiple candidates: auto-select only if one is clearly best (confidence gap > 0.15)
  const ranked = rankCandidates(deployable);
  const [first, second] = ranked;
  if (first.confidence - second.confidence > 0.15) {
    return {
      recommendedRootDirectory: first.rootDirectory,
      requiresUserSelection: false,
    };
  }

  return {
    recommendedRootDirectory: ranked[0].rootDirectory,
    requiresUserSelection: true,
  };
}
