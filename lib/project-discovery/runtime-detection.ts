import path from "node:path";
import { readFile } from "node:fs/promises";

export interface RuntimeDetectionResult {
  nodeVersion?: string;
  pythonVersion?: string;
  rubyVersion?: string;
  goVersion?: string;
  rustVersion?: string;
}

/**
 * Detect pinned runtime versions from version files and manifests.
 * Never invents a version if one is not declared.
 */
export async function detectRuntimeVersions(
  dir: string,
  files: string[],
): Promise<RuntimeDetectionResult> {
  const result: RuntimeDetectionResult = {};

  // Node.js version
  if (files.includes(".nvmrc")) {
    try {
      const content = (await readFile(path.join(dir, ".nvmrc"), "utf8")).trim();
      result.nodeVersion = content.startsWith("v") ? content.slice(1) : content;
    } catch {}
  }
  if (!result.nodeVersion && files.includes(".node-version")) {
    try {
      const content = (await readFile(path.join(dir, ".node-version"), "utf8")).trim();
      result.nodeVersion = content.startsWith("v") ? content.slice(1) : content;
    } catch {}
  }
  if (!result.nodeVersion && files.includes("package.json")) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
      const enginesNode = pkg.engines?.node;
      if (typeof enginesNode === "string") {
        const match = enginesNode.match(/(\d+\.\d+[\.\d]*)/);
        if (match) result.nodeVersion = match[1];
      }
    } catch {}
  }

  // Python version
  if (files.includes(".python-version")) {
    try {
      const content = (await readFile(path.join(dir, ".python-version"), "utf8")).trim();
      result.pythonVersion = content;
    } catch {}
  }
  if (!result.pythonVersion && files.includes("pyproject.toml")) {
    try {
      const content = await readFile(path.join(dir, "pyproject.toml"), "utf8");
      const match = content.match(/python_requires\s*=\s*["']([^"']+)["']/);
      if (match) result.pythonVersion = match[1];
    } catch {}
  }

  // Ruby version
  if (files.includes(".ruby-version")) {
    try {
      const content = (await readFile(path.join(dir, ".ruby-version"), "utf8")).trim();
      result.rubyVersion = content;
    } catch {}
  }

  // Go version
  if (files.includes("go.mod")) {
    try {
      const content = await readFile(path.join(dir, "go.mod"), "utf8");
      const match = content.match(/^go\s+(\d+\.\d+[\.\d]*)/m);
      if (match) result.goVersion = match[1];
    } catch {}
  }

  // Rust version
  if (files.includes("rust-toolchain.toml")) {
    try {
      const content = await readFile(path.join(dir, "rust-toolchain.toml"), "utf8");
      const match = content.match(/channel\s*=\s*["']([^"']+)["']/);
      if (match) result.rustVersion = match[1];
    } catch {}
  }

  return result;
}
