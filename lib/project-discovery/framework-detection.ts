import path from "node:path";
import { readFile } from "node:fs/promises";
import { LocalFileSystemDetector, detectFramework, detectFrameworkVersion, packageManagers } from "@vercel/fs-detectors";
import { frameworkList } from "@vercel/frameworks";
import { detectJavaScriptFramework } from "./detectors/javascript";
import { detectPythonFramework } from "./detectors/python";
import { detectGoFramework } from "./detectors/go";
import { detectRustFramework } from "./detectors/rust";
import { detectPhpFramework } from "./detectors/php";
import { detectRubyFramework } from "./detectors/ruby";
import { detectElixirFramework } from "./detectors/elixir";
import { detectJavaOrDotnet } from "./detectors/java-dotnet";

export interface FrameworkDetectionResult {
  framework: string | null;
  frameworkName: string | null;
  language: string | null;
  runtime: string | null;
  packageManager: string | null;
  packageManagerVersion?: string;
  detectedVersion?: string;
  configFiles: string[];
  confidence: number;
}

/**
 * Detect a package manager in a given directory using @vercel/fs-detectors'
 * packageManagers definitions, then fall back to manual lockfile checks.
 */
async function detectPackageManager(dir: string, files: string[]): Promise<string | null> {
  // Priority: lockfiles first, then packageManager field
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";

  // Check packageManager field in package.json
  if (files.includes("package.json")) {
    try {
      const raw = await readFile(path.join(dir, "package.json"), "utf8");
      const pkg = JSON.parse(raw);
      if (typeof pkg.packageManager === "string") {
        const pm = pkg.packageManager.split("@")[0].toLowerCase();
        if (["npm", "pnpm", "yarn", "bun"].includes(pm)) return pm;
      }
    } catch {}
  }

  return null;
}

/**
 * Find a Dockerfile in a directory (case-insensitive).
 */
export function findDockerfile(files: string[]): string | null {
  for (const f of files) {
    const lower = f.toLowerCase();
    if (lower === "dockerfile" || lower === "containerfile") return f;
  }
  return null;
}

/**
 * Returns the "interesting" config files that help confirm framework detection.
 */
function collectConfigFiles(files: string[]): string[] {
  const configExtensions = new Set([
    "next.config.ts", "next.config.js", "next.config.mjs",
    "vite.config.ts", "vite.config.js", "vite.config.mjs",
    "astro.config.ts", "astro.config.mjs", "astro.config.js",
    "svelte.config.js", "svelte.config.ts",
    "nuxt.config.ts", "nuxt.config.js",
    "angular.json",
    "remix.config.ts", "remix.config.js",
    "nest-cli.json",
    "turbo.json",
    "nx.json",
    "lerna.json",
    "tsconfig.json",
    "package.json",
    "composer.json",
    "Cargo.toml",
    "go.mod",
    "Gemfile",
    "mix.exs",
    "pyproject.toml",
    "requirements.txt",
  ]);
  return files.filter((f) => configExtensions.has(f));
}

/**
 * Main framework detection for a single candidate directory.
 * Uses @vercel/fs-detectors detectFramework for JS/TS projects, then
 * falls back to custom detectors for other ecosystems.
 */
export async function detectFrameworkForDir(
  absoluteDir: string,
  files: string[],
): Promise<FrameworkDetectionResult> {
  const configFiles = collectConfigFiles(files);
  const dockerfilePath = findDockerfile(files);
  let confidence = 0;
  let framework: string | null = null;
  let frameworkName: string | null = null;
  let language: string | null = null;
  let runtime: string | null = null;
  let packageManager: string | null = null;
  let detectedVersion: string | undefined;

  // --- 1. Try @vercel/fs-detectors for JS/TS frameworks ---
  if (files.includes("package.json")) {
    try {
      const fsDetector = new LocalFileSystemDetector(absoluteDir);
      const slug = await detectFramework({ fs: fsDetector, frameworkList });

      if (slug) {
        const meta = frameworkList.find((f) => f.slug === slug);
        framework = slug;
        frameworkName = meta?.name ?? slug;
        confidence = 0.9;

        // Try version detection
        try {
          const ver = await detectFrameworkVersion({ fs: fsDetector, framework: slug });
          detectedVersion = ver ?? undefined;
        } catch {}

        language = "typescript";
        runtime = "nodejs";
      }
    } catch {}

    // If vercel detected "container" slug, treat it as unknown and fall through
    if (framework === "container" || framework === "static") {
      framework = null;
      frameworkName = null;
      confidence = 0;
    }
  }

  // If vercel didn't identify a framework, try our custom JS detectors
  if (!framework && files.includes("package.json")) {
    const jsResult = await detectJavaScriptFramework(absoluteDir, files);
    if (jsResult) {
      framework = jsResult.slug;
      frameworkName = jsResult.name;
      confidence = jsResult.confidence;
      detectedVersion = jsResult.version;
      language = "typescript";
      runtime = "nodejs";
    }
  }

  // --- 2. Python ---
  if (!framework) {
    const pyResult = await detectPythonFramework(absoluteDir, files);
    if (pyResult) {
      framework = pyResult.framework;
      frameworkName = pyResult.frameworkName;
      confidence = pyResult.confidence;
      detectedVersion = pyResult.version;
      language = "python";
      runtime = "python";
    }
  }

  // --- 3. Go ---
  if (!framework) {
    const goResult = await detectGoFramework(absoluteDir, files);
    if (goResult) {
      framework = goResult.framework;
      frameworkName = goResult.frameworkName;
      confidence = goResult.confidence;
      language = "go";
      runtime = "go";
    }
  }

  // --- 4. Rust ---
  if (!framework) {
    const rustResult = await detectRustFramework(absoluteDir, files);
    if (rustResult) {
      framework = rustResult.framework;
      frameworkName = rustResult.frameworkName;
      confidence = rustResult.confidence;
      language = "rust";
      runtime = "rust";
    }
  }

  // --- 5. PHP ---
  if (!framework) {
    const phpResult = await detectPhpFramework(absoluteDir, files);
    if (phpResult) {
      framework = phpResult.framework;
      frameworkName = phpResult.frameworkName;
      confidence = phpResult.confidence;
      language = "php";
      runtime = "php";
    }
  }

  // --- 6. Ruby ---
  if (!framework) {
    const rubyResult = await detectRubyFramework(absoluteDir, files);
    if (rubyResult) {
      framework = rubyResult.framework;
      frameworkName = rubyResult.frameworkName;
      confidence = rubyResult.confidence;
      language = "ruby";
      runtime = "ruby";
    }
  }

  // --- 7. Elixir ---
  if (!framework) {
    const elixirResult = await detectElixirFramework(absoluteDir, files);
    if (elixirResult) {
      framework = elixirResult.framework;
      frameworkName = elixirResult.frameworkName;
      confidence = elixirResult.confidence;
      language = "elixir";
      runtime = "elixir";
    }
  }

  // --- 8. Java / .NET ---
  if (!framework) {
    const jdResult = await detectJavaOrDotnet(absoluteDir, files);
    if (jdResult) {
      framework = jdResult.framework;
      frameworkName = jdResult.frameworkName;
      confidence = jdResult.confidence;
      language = jdResult.language;
      runtime = jdResult.runtime;
    }
  }

  // --- 9. Package manager (for JS/Node) ---
  if (files.includes("package.json") || runtime === "nodejs") {
    packageManager = await detectPackageManager(absoluteDir, files);
    if (!runtime) runtime = "nodejs";
    if (!language) {
      // Check for TypeScript
      language = files.includes("tsconfig.json") ? "typescript" : "javascript";
    }
  }

  return {
    framework,
    frameworkName,
    language,
    runtime,
    packageManager,
    detectedVersion,
    configFiles,
    confidence,
  };
}
