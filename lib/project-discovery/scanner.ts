import path from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";
import { normalizeRelativePath } from "./path-validation";

export const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".nx",
  "vendor",
  ".venv",
  "venv",
  "env",
  ".cargo",
  "target",
  "bin",
  "obj",
  ".idea",
  ".vscode",
  "coverage",
  ".output",
  ".cache",
  ".vinext",
  ".cloudflare",
  "tmp",
]);

export const MANIFEST_INDICATORS = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nx.json",
  "lerna.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "poetry.lock",
  "uv.lock",
  "composer.json",
  "Cargo.toml",
  "go.mod",
  "go.work",
  "Gemfile",
  "mix.exs",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "Dockerfile",
  "Containerfile",
  "dockerfile",
  "containerfile",
]);

export interface ScanOptions {
  maxDepth?: number;
  maxFiles?: number;
}

export interface DiscoveredDirectory {
  relativePath: string; // "." or "apps/web"
  absolutePath: string;
  files: string[];
  manifests: string[];
}

export interface RepositoryScan {
  directories: Map<string, DiscoveredDirectory>;
  allFilesCount: number;
  warnings: string[];
}

export async function scanRepository(
  repoRoot: string,
  options: ScanOptions = {},
): Promise<RepositoryScan> {
  const maxDepth = options.maxDepth ?? 5;
  const maxFiles = options.maxFiles ?? 5000;

  const realRoot = await realpath(repoRoot);
  const directories = new Map<string, DiscoveredDirectory>();
  const warnings: string[] = [];
  let fileCount = 0;
  const visitedRealPaths = new Set<string>();

  async function walk(currentAbsPath: string, depth: number) {
    if (depth > maxDepth) return;
    if (fileCount >= maxFiles) {
      if (!warnings.includes("Maximum file scan limit reached; some deeply nested files may have been skipped.")) {
        warnings.push("Maximum file scan limit reached; some deeply nested files may have been skipped.");
      }
      return;
    }

    let realCurrent: string;
    try {
      realCurrent = await realpath(currentAbsPath);
    } catch {
      return;
    }

    // Escape prevention
    if (!realCurrent.startsWith(realRoot)) {
      return;
    }

    // Loop prevention
    if (visitedRealPaths.has(realCurrent)) {
      return;
    }
    visitedRealPaths.add(realCurrent);

    const relPath = normalizeRelativePath(path.relative(repoRoot, currentAbsPath));

    let entries;
    try {
      entries = await readdir(currentAbsPath, { withFileTypes: true });
    } catch {
      return;
    }

    const files: string[] = [];
    const manifests: string[] = [];
    const subdirs: string[] = [];

    for (const entry of entries) {
      fileCount++;
      if (fileCount > maxFiles) break;

      const name = entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(name) && !name.startsWith(".")) {
          subdirs.push(name);
        }
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        files.push(name);
        if (
          MANIFEST_INDICATORS.has(name) ||
          MANIFEST_INDICATORS.has(name.toLowerCase()) ||
          name.endsWith(".csproj") ||
          name.endsWith(".sln")
        ) {
          manifests.push(name);
        }
      }
    }

    // Record directory if it has manifests, or is root, or has relevant files
    if (relPath === "." || manifests.length > 0) {
      directories.set(relPath, {
        relativePath: relPath,
        absolutePath: currentAbsPath,
        files,
        manifests,
      });
    }

    for (const subdir of subdirs) {
      await walk(path.join(currentAbsPath, subdir), depth + 1);
    }
  }

  await walk(repoRoot, 0);

  return {
    directories,
    allFilesCount: fileCount,
    warnings,
  };
}
