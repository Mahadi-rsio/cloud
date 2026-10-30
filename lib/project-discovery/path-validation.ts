import path from "node:path";
import { realpath, stat } from "node:fs/promises";

/**
 * Normalizes a relative path from the repository root to standard POSIX format.
 * Returns "." for empty or root paths.
 */
export function normalizeRelativePath(rawPath: string): string {
  if (!rawPath) return ".";
  // Replace backslashes with slashes
  let clean = rawPath.replace(/\\/g, "/").trim();
  // Strip leading slashes
  clean = clean.replace(/^\/+/, "");
  // Strip trailing slashes
  clean = clean.replace(/\/+$/, "");

  if (!clean || clean === "." || clean === "./") {
    return ".";
  }

  // Normalize path segments
  const parts = clean.split("/").filter(Boolean);
  const resolvedParts: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      throw new Error(`Path traversal is not permitted: ${rawPath}`);
    }
    resolvedParts.push(part);
  }

  return resolvedParts.length > 0 ? resolvedParts.join("/") : ".";
}

/**
 * Validates that candidate relative path is safe and does not escape repo root.
 * Returns normalized relative path (e.g. "." or "apps/web").
 */
export async function validateSafePath(repoRoot: string, targetPath: string): Promise<string> {
  if (path.isAbsolute(targetPath)) {
    throw new Error(`Absolute paths are not allowed: ${targetPath}`);
  }
  if (targetPath.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${targetPath}`);
  }

  const normalized = normalizeRelativePath(targetPath);
  const resolvedTarget = path.resolve(repoRoot, normalized);
  const resolvedRoot = path.resolve(repoRoot);

  // Check prefix
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw new Error(`Path escapes repository boundaries: ${targetPath}`);
  }

  // Check symlink realpath if path exists
  try {
    const realRoot = await realpath(resolvedRoot);
    const realTarget = await realpath(resolvedTarget);

    if (!realTarget.startsWith(realRoot)) {
      throw new Error(`Symlink traversal escapes repository boundaries: ${targetPath}`);
    }
  } catch (err: unknown) {
    // If it doesn't exist, stat will fail
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(`Path does not exist in repository: ${targetPath}`);
    }
    throw err;
  }

  return normalized;
}
