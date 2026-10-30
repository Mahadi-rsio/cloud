import path from "node:path";
import { readFile } from "node:fs/promises";
import type { WorkspaceInfo } from "./types";
import { normalizeRelativePath } from "./path-validation";

export interface WorkspaceDetectionResult {
  isMonorepo: boolean;
  workspaces: WorkspaceInfo[];
  declaredPackageDirs: string[];
}

/**
 * Parses glob-like patterns such as "apps/*", "packages/*", "services/**" into directory prefixes.
 */
function extractBaseDirsFromGlobs(patterns: string[]): string[] {
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    const clean = pattern.replace(/[/*]+$/, "");
    if (clean && !clean.includes("*")) {
      dirs.add(clean);
    }
  }
  return Array.from(dirs);
}

export async function detectWorkspaces(repoRoot: string): Promise<WorkspaceDetectionResult> {
  const workspaces: WorkspaceInfo[] = [];
  const declaredPackageDirs = new Set<string>();
  let isMonorepo = false;

  // 1. Check pnpm-workspace.yaml
  try {
    const content = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    isMonorepo = true;
    const lines = content.split("\n");
    const packages: string[] = [];
    let inPackages = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("packages:")) {
        inPackages = true;
        continue;
      }
      if (inPackages) {
        if (trimmed.startsWith("-")) {
          const raw = trimmed.replace(/^-\s*['"]?/, "").replace(/['"]?\s*$/, "");
          packages.push(raw);
        } else if (trimmed && !trimmed.startsWith("#")) {
          inPackages = false;
        }
      }
    }
    workspaces.push({
      type: "pnpm",
      configFile: "pnpm-workspace.yaml",
      packages,
    });
    for (const dir of extractBaseDirsFromGlobs(packages)) {
      declaredPackageDirs.add(dir);
    }
  } catch {
    // No pnpm-workspace.yaml
  }

  // 2. Check root package.json for npm/yarn workspaces
  try {
    const pkgRaw = await readFile(path.join(repoRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw);
    if (pkg.workspaces) {
      isMonorepo = true;
      const patterns = Array.isArray(pkg.workspaces)
        ? pkg.workspaces
        : Array.isArray(pkg.workspaces.packages)
          ? pkg.workspaces.packages
          : [];

      workspaces.push({
        type: "npm",
        configFile: "package.json",
        packages: patterns,
      });
      for (const dir of extractBaseDirsFromGlobs(patterns)) {
        declaredPackageDirs.add(dir);
      }
    }
  } catch {
    // Invalid or missing package.json
  }

  // 3. Check turbo.json
  try {
    await readFile(path.join(repoRoot, "turbo.json"), "utf8");
    isMonorepo = true;
    workspaces.push({
      type: "turbo",
      configFile: "turbo.json",
      packages: [],
    });
  } catch {
    // No turbo.json
  }

  // 4. Check nx.json
  try {
    await readFile(path.join(repoRoot, "nx.json"), "utf8");
    isMonorepo = true;
    workspaces.push({
      type: "nx",
      configFile: "nx.json",
      packages: [],
    });
  } catch {
    // No nx.json
  }

  // 5. Check lerna.json
  try {
    const lernaRaw = await readFile(path.join(repoRoot, "lerna.json"), "utf8");
    isMonorepo = true;
    const lerna = JSON.parse(lernaRaw);
    const packages = Array.isArray(lerna.packages) ? lerna.packages : [];
    workspaces.push({
      type: "lerna",
      configFile: "lerna.json",
      packages,
    });
    for (const dir of extractBaseDirsFromGlobs(packages)) {
      declaredPackageDirs.add(dir);
    }
  } catch {
    // No lerna.json
  }

  // 6. Check Cargo.toml workspace
  try {
    const cargoRaw = await readFile(path.join(repoRoot, "Cargo.toml"), "utf8");
    if (cargoRaw.includes("[workspace]")) {
      isMonorepo = true;
      const membersMatch = cargoRaw.match(/members\s*=\s*\[([^\]]+)\]/);
      const members = membersMatch
        ? membersMatch[1]
            .split(",")
            .map((m) => m.trim().replace(/['"]/g, ""))
            .filter(Boolean)
        : [];
      workspaces.push({
        type: "cargo",
        configFile: "Cargo.toml",
        packages: members,
      });
      for (const dir of extractBaseDirsFromGlobs(members)) {
        declaredPackageDirs.add(dir);
      }
    }
  } catch {
    // No Cargo.toml
  }

  // 7. Check go.work
  try {
    const goWork = await readFile(path.join(repoRoot, "go.work"), "utf8");
    isMonorepo = true;
    const uses = [...goWork.matchAll(/use\s+(?:\(\s*([^)]+)\s*\)|([^\s\n]+))/g)];
    const packages: string[] = [];
    for (const match of uses) {
      if (match[1]) {
        packages.push(...match[1].split(/\s+/).filter(Boolean));
      } else if (match[2]) {
        packages.push(match[2].trim());
      }
    }
    workspaces.push({
      type: "go",
      configFile: "go.work",
      packages,
    });
    for (const pkg of packages) {
      declaredPackageDirs.add(normalizeRelativePath(pkg));
    }
  } catch {
    // No go.work
  }

  return {
    isMonorepo,
    workspaces,
    declaredPackageDirs: Array.from(declaredPackageDirs),
  };
}
