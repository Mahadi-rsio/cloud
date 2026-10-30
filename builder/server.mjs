#!/usr/bin/env node
/**
 * Cloudisy build worker.
 *
 * Runs on a single shared, isolated Fly machine. It accepts one build at a
 * time from the control plane, clones the public repository, asks Railpack for
 * a build plan (or uses the repo's Dockerfile), builds and pushes an OCI image
 * with BuildKit, then reports the result back to the control plane.
 *
 * The builder never holds Fly credentials and never receives customer secrets:
 * the control plane owns deployment. It only needs registry credentials.
 *
 * Environment:
 *   PORT                     HTTP port (default 8080)
 *   BUILDER_API_TOKEN        shared secret the control plane presents
 *   INTERNAL_API_TOKEN       shared secret used when calling back
 *   CONTROL_PLANE_URL        e.g. https://app.example.com
 *   OCI_REGISTRY             e.g. ghcr.io/acme
 *   OCI_REGISTRY_USERNAME    registry user
 *   OCI_REGISTRY_PASSWORD    registry password/token
 *   BUILD_WORKSPACE_DIR      scratch dir (default /tmp/cloudisy-builds)
 *   BUILD_IDLE_TIMEOUT_MS    exit after this long with no work (default 10 min)
 *   BUILD_DEFAULT_INTERNAL_PORT default app port when it cannot be detected (8080)
 *   RAILPACK_BIN             railpack binary (default "railpack")
 *   BUILDKIT_HOST            if set, use buildctl against this BuildKit address
 *   RAILPACK_FRONTEND_IMAGE  frontend image (default ghcr.io/railwayapp/railpack-frontend)
 *   RAILPACK_BUILDER_IMAGE   builder image plans are rewritten to use; baked
 *                            with common runtimes preinstalled. When unset it
 *                            defaults to the upstream builder image, in which
 *                            case plans are left untouched.
 *   GITHUB_TOKEN             optional token to raise GitHub rate limits
 *   ENABLE_BUILDKITD         entrypoint hint only
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const config = {
  port: Number(process.env.PORT ?? 8080),
  builderApiToken: process.env.BUILDER_API_TOKEN ?? "",
  internalToken: process.env.INTERNAL_API_TOKEN ?? "",
  controlPlaneUrl: (process.env.CONTROL_PLANE_URL ?? "").replace(/\/+$/, ""),
  registry: (process.env.OCI_REGISTRY ?? "").replace(/\/+$/, ""),
  registryUsername: process.env.OCI_REGISTRY_USERNAME ?? "",
  registryPassword: process.env.OCI_REGISTRY_PASSWORD ?? "",
  workspaceDir: process.env.BUILD_WORKSPACE_DIR ?? path.join(os.tmpdir(), "cloudisy-builds"),
  idleTimeoutMs: positiveInt(process.env.BUILD_IDLE_TIMEOUT_MS, 10 * 60 * 1000),
  defaultInternalPort: positiveInt(process.env.BUILD_DEFAULT_INTERNAL_PORT, 8080),
  railpackBin: process.env.RAILPACK_BIN ?? "railpack",
  buildStrategy: (process.env.BUILD_STRATEGY ?? "auto").toLowerCase(),
  buildkitHost: process.env.BUILDKIT_HOST ?? "",
  frontendImage:
    process.env.RAILPACK_FRONTEND_IMAGE ?? "ghcr.io/railwayapp/railpack-frontend",
  // Builder image that plans are rewritten to use. When it is the upstream
  // image (or unset, which resolves to the upstream default), the rewrite is a
  // no-op and plans build exactly as Railpack generated them.
  railpackBuilderImage:
    process.env.RAILPACK_BUILDER_IMAGE ??
    "ghcr.io/railwayapp/railpack-builder:mise-2026.10.14",
  githubToken: process.env.GITHUB_TOKEN ?? "",
  maxBuildMs: positiveInt(process.env.BUILD_MAX_DURATION_MS, 25 * 60 * 1000),
};

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function log(message) {
  console.log(`[builder] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* Control plane callbacks                                             */
/* ------------------------------------------------------------------ */

async function callControlPlane(pathname, body, retries = 2, timeoutMs = 20_000) {
  if (!config.controlPlaneUrl || !config.internalToken) {
    log(`cannot call ${pathname}: CONTROL_PLANE_URL/INTERNAL_API_TOKEN missing`);
    return { ok: false, error: "CONTROL_PLANE_URL or INTERNAL_API_TOKEN missing" };
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${config.controlPlaneUrl}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.internalToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return { ok: true };
      const text = await response.text().catch(() => "");
      lastError = new Error(`status ${response.status}: ${text.slice(0, 300)}`);
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleep(1_000 * (attempt + 1));
  }
  log(`callback ${pathname} failed: ${lastError?.message ?? "unknown error"}`);
  return { ok: false, error: lastError?.message ?? "unknown error" };
}

function sendStatus(deploymentId, status, extra = {}) {
  return callControlPlane(
    `/api/v1/internal/deployments/${deploymentId}/status`,
    { status, ...extra },
    1,
    15_000,
  );
}

class LogSink {
  constructor(deploymentId) {
    this.deploymentId = deploymentId;
    this.entries = [];
    this.timer = null;
    this.chain = Promise.resolve();
    this.closed = false;
  }

  start() {
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, 500);
    this.timer.unref?.();
  }

  push(stream, message) {
    if (this.closed) return;
    const clean = String(message ?? "")
      .replace(/\u0000/g, "")
      .slice(0, 20_000);
    this.entries.push({
      stream,
      message: clean.length > 0 ? clean : "(empty line)",
    });
    if (this.entries.length >= 100) this.flush().catch(() => {});
  }

  flush() {
    if (this.entries.length === 0) return this.chain;
    const batch = this.entries.splice(0, this.entries.length);
    this.chain = this.chain
      .then(() =>
        callControlPlane(
          `/api/v1/internal/deployments/${this.deploymentId}/logs`,
          { entries: batch },
          1,
        ),
      )
      .catch((error) => log(`log flush failed: ${error?.message ?? error}`));
    return this.chain;
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.flush();
    await this.chain;
  }
}

/* ------------------------------------------------------------------ */
/* Process helpers                                                     */
/* ------------------------------------------------------------------ */

function killTree(child) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    timeoutMs = 10 * 60 * 1000,
    onLine,
    input,
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const stdout = [];
    const stderr = [];
    let child;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.join("\n").trim(),
        stderr: stderr.join("\n").trim(),
        ...result,
      });
    };

    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      resolve({ code: null, signal: null, error, stdout: "", stderr: "" });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    const stdoutReader = createInterface({ input: child.stdout });
    stdoutReader.on("line", (line) => {
      stdout.push(line);
      if (onLine) onLine("stdout", line);
    });

    const stderrReader = createInterface({ input: child.stderr });
    stderrReader.on("line", (line) => {
      stderr.push(line);
      if (onLine) onLine("stderr", line);
    });

    child.on("error", (error) => {
      stdoutReader.close();
      stderrReader.close();
      finish({ code: null, signal: null, error });
    });

    child.on("close", (code, signal) => {
      stdoutReader.close();
      stderrReader.close();
      finish({ code, signal, timedOut });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/* ------------------------------------------------------------------ */
/* Build steps                                                         */
/* ------------------------------------------------------------------ */

function parseInfo(raw) {
  const info = raw && typeof raw === "object" ? raw : {};
  const logs = [];
  if (Array.isArray(info.logs)) {
    for (const entry of info.logs) {
      if (typeof entry === "string") logs.push(entry);
      else if (entry && typeof entry === "object" && typeof entry.message === "string") {
        logs.push(entry.message);
      }
    }
  }
  const ports = [];
  const collect = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
    } else if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536) {
      ports.push(value);
    } else if (typeof value === "string" && /^\d+$/.test(value)) {
      const port = Number(value);
      if (port > 0 && port < 65536) ports.push(port);
    }
  };
  collect(info.ports);
  collect(info.internalPort);
  collect(info.internal_port);
  if (info.build && typeof info.build === "object") collect(info.build.ports);

  const provider =
    (typeof info.provider === "string" && info.provider) ||
    (Array.isArray(info.providers) && typeof info.providers[0] === "string"
      ? info.providers[0]
      : null);

  return {
    success: info.success !== false,
    provider,
    internalPort: ports[0] ?? null,
    logs,
    error: typeof info.error === "string" ? info.error : null,
  };
}

async function readInfo(infoPath) {
  try {
    return parseInfo(JSON.parse(await readFile(infoPath, "utf8")));
  } catch {
    return { success: true, provider: null, internalPort: null, logs: [], error: null };
  }
}

const UPSTREAM_RAILPACK_BUILDER_RE = /^ghcr\.io\/railwayapp\/railpack-builder:/;

/**
 * Rewrite a generated Railpack plan so builds use our baked builder image and
 * prune the runtimes the app does not need before the deploy image is built,
 * and prevent user layers from being shared across deployments.
 *
 * - When `builderImage` is a custom image:
 *   - Every step input that references the upstream builder image (the
 *     `packages:mise` step and the `install_bin` helper) is pointed at
 *     `builderImage`.
 *   - The `packages:mise` step gets `mise prune --yes` appended after `mise
 *     install`. Pruning with `--yes` removes the runtimes baked into the builder
 *     image that the app's /etc/mise/config.toml does not request, so node/python
 *     deploy images (which copy the whole /mise/installs tree) stay small.
 * - When `cacheKey` is provided (typically the deployment ID):
 *   - Every step whose name is a string and does not start with `packages:`
 *     (e.g. `install`, `build`) gets a unique dummy command
 *     `true # cloudisy-nocache:<cacheKey>` prepended as its first command.
 *     Because BuildKit's layer cache is content-addressed, a unique first exec
 *     invalidates the cache for that step and every step chained after it,
 *     preventing cross-deployment layer reuse (npm install, node_modules, build
 *     outputs) while allowing generic `packages:*` layers (apt, mise runtimes)
 *     and base images to remain cached on the volume.
 *
 * Returns the rewritten plan document, or null when neither rewrite applies.
 */
async function rewriteRailpackPlan(planPath, builderImage, cacheKey) {
  const rewriteImage = Boolean(builderImage) && !UPSTREAM_RAILPACK_BUILDER_RE.test(builderImage);
  if (!rewriteImage && !cacheKey) return null;

  let plan;
  try {
    plan = JSON.parse(await readFile(planPath, "utf8"));
  } catch {
    throw new Error(`Could not read the build plan at ${planPath}.`);
  }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.steps)) return null;

  let replaced = false;
  for (const step of plan.steps) {
    if (rewriteImage) {
      for (const input of step.inputs ?? []) {
        if (typeof input.image === "string" && UPSTREAM_RAILPACK_BUILDER_RE.test(input.image)) {
          input.image = builderImage;
          replaced = true;
        }
      }
      if (step.name === "packages:mise") {
        const commands = step.commands ?? [];
        const installIndex = commands.findIndex((command) => command.cmd === "mise install");
        if (installIndex !== -1 && !commands.some((command) => command.cmd === "mise prune --yes")) {
          commands.push({ cmd: "mise prune --yes", customName: "prune unused runtimes" });
          replaced = true;
        }
      }
    }

    if (cacheKey && typeof step.name === "string" && !step.name.startsWith("packages:")) {
      const markerName = `cloudisy-nocache:${cacheKey}`;
      const commands = step.commands ?? [];
      if (!commands.some((command) => command.customName === markerName)) {
        commands.unshift({ cmd: `true # ${markerName}`, customName: markerName });
        step.commands = commands;
        replaced = true;
      }
    }
  }

  if (!replaced) return null;
  await writeFile(planPath, JSON.stringify(plan));
  log(
    `rewrote plan${rewriteImage ? ` to use builder image ${builderImage} with runtime pruning` : ""}${cacheKey ? ` with cacheKey ${cacheKey}` : ""}`,
  );
  return plan;
}

async function cloneRepo(job, appDir, onLine) {
  const url = new URL(job.repoUrl);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("Only https://github.com repositories are supported.");
  }
  if (url.username || url.password) {
    throw new Error("Repository URLs must not contain credentials.");
  }
  if (!/^[A-Za-z0-9._\-\/]+$/.test(job.branch) || job.branch.startsWith("-")) {
    throw new Error("Unsupported branch name.");
  }

  await mkdir(appDir, { recursive: true });
  const clone = await runCommand(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--single-branch",
      `--branch=${job.branch}`,
      job.repoUrl,
      appDir,
    ],
    {
      timeoutMs: 5 * 60 * 1000,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" },
      onLine: (_stream, line) => onLine("stdout", line),
    },
  );

  if (clone.error) throw new Error(`git is not available: ${clone.error.message}`);
  if (clone.code !== 0) {
    throw new Error(`git clone failed (exit ${clone.code ?? clone.signal ?? "unknown"}).`);
  }

  const head = await runCommand("git", ["rev-parse", "HEAD"], {
    cwd: appDir,
    timeoutMs: 30_000,
  });
  return head.code === 0 && head.stdout ? head.stdout : null;
}

async function detectStrategy(appDir) {
  const entries = await readdir(appDir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const dockerfile =
    files.find((name) => name.toLowerCase() === "dockerfile") ??
    files.find((name) => name.toLowerCase() === "containerfile") ??
    null;

  // `BUILD_STRATEGY=railpack` forces Railpack even when a Dockerfile exists
  // (e.g. Nx-generated Dockerfiles that assume a prebuilt dist/).
  if (config.buildStrategy === "railpack") return { dockerfile: null };
  if (config.buildStrategy === "dockerfile" && !dockerfile) {
    throw new Error("BUILD_STRATEGY=dockerfile but no Dockerfile found.");
  }
  return { dockerfile };
}

/* ------------------------------------------------------------------ */
/* Inline Project Discovery Engine                                     */
/* ------------------------------------------------------------------ */

const DISCOVERY_VERSION = "1.0.0";

const DISCOVERY_IGNORED_DIRS = new Set([
  ".git", "node_modules", ".next", "dist", "build", ".turbo", ".nx",
  "vendor", ".venv", "venv", "env", ".cargo", "target", "bin", "obj",
  ".idea", ".vscode", "coverage", ".output", ".cache", "tmp",
]);

const DISCOVERY_DEPLOYABLE_FILES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "Pipfile",
  "go.mod", "Cargo.toml", "composer.json", "artisan", "Gemfile",
  "mix.exs", "pom.xml", "build.gradle", "build.gradle.kts",
  "Dockerfile", "dockerfile", "Containerfile", "containerfile",
]);

function discoveryNormalizePath(rawPath) {
  if (!rawPath) return ".";
  const clean = rawPath.replace(/\\/g, "/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean || clean === ".") return ".";
  const parts = clean.split("/").filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") throw new Error(`Path traversal rejected: ${rawPath}`);
    resolved.push(part);
  }
  return resolved.length > 0 ? resolved.join("/") : ".";
}

async function discoveryValidateRoot(repoRoot, selectedRoot) {
  const normalized = discoveryNormalizePath(selectedRoot);
  const abs = path.resolve(repoRoot, normalized);
  if (!abs.startsWith(path.resolve(repoRoot))) {
    throw new Error(`Path escapes repository: ${selectedRoot}`);
  }
  try {
    const real = await realpath(abs);
    const realRoot = await realpath(repoRoot);
    if (!real.startsWith(realRoot)) throw new Error(`Symlink escape: ${selectedRoot}`);
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`Path does not exist: ${selectedRoot}`);
    throw err;
  }
  return abs;
}

function detectPkgManager(files) {
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("package-lock.json")) return "npm";
  return null;
}

function hasDeployableSignal(files) {
  return files.some(
    (f) => DISCOVERY_DEPLOYABLE_FILES.has(f) || f.endsWith(".csproj") || f.endsWith(".sln"),
  );
}

async function detectFrameworkForDiscovery(dirPath, files) {
  let pkg = null;
  if (files.includes("package.json")) {
    try { pkg = JSON.parse(await readFile(path.join(dirPath, "package.json"), "utf8")); } catch {}
  }
  const allDeps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};

  if (pkg) {
    if (allDeps["@tanstack/react-start"] || allDeps["@tanstack/start"])
      return { slug: "tanstack-start", name: "TanStack Start", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["next"] || files.some(f => f.startsWith("next.config.")))
      return { slug: "nextjs", name: "Next.js", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["astro"] || files.some(f => f.startsWith("astro.config.")))
      return { slug: "astro", name: "Astro", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["@sveltejs/kit"] || files.some(f => f.startsWith("svelte.config.")))
      return { slug: "sveltekit", name: "SvelteKit", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["nuxt"] || files.some(f => f.startsWith("nuxt.config.")))
      return { slug: "nuxt", name: "Nuxt", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (files.includes("angular.json") || allDeps["@angular/core"])
      return { slug: "angular", name: "Angular", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["@remix-run/react"] || allDeps["@react-router/dev"] || allDeps["remix"])
      return { slug: "remix", name: "Remix", confidence: 0.95, language: "typescript", runtime: "nodejs" };
    if (allDeps["@nestjs/core"] || files.includes("nest-cli.json"))
      return { slug: "nestjs", name: "NestJS", confidence: 0.92, language: "typescript", runtime: "nodejs" };
    if (allDeps["hono"])
      return { slug: "hono", name: "Hono", confidence: 0.9, language: "typescript", runtime: "nodejs" };
    if (allDeps["fastify"])
      return { slug: "fastify", name: "Fastify", confidence: 0.9, language: "javascript", runtime: "nodejs" };
    if (allDeps["express"])
      return { slug: "express", name: "Express", confidence: 0.88, language: "javascript", runtime: "nodejs" };
    if (allDeps["vite"] || files.some(f => f.startsWith("vite.config.")))
      return { slug: "vite", name: "Vite", confidence: 0.85, language: "typescript", runtime: "nodejs" };
    return { slug: null, name: null, confidence: 0.5, language: files.includes("tsconfig.json") ? "typescript" : "javascript", runtime: "nodejs" };
  }

  if (files.includes("manage.py"))
    return { slug: "django", name: "Django", confidence: 0.95, language: "python", runtime: "python" };
  if (files.includes("requirements.txt") || files.includes("pyproject.toml") || files.includes("Pipfile")) {
    let txt = "";
    for (const mf of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
      if (files.includes(mf)) try { txt += await readFile(path.join(dirPath, mf), "utf8"); } catch {}
    }
    const lo = txt.toLowerCase();
    if (lo.includes("django")) return { slug: "django", name: "Django", confidence: 0.9, language: "python", runtime: "python" };
    if (lo.includes("fastapi")) return { slug: "fastapi", name: "FastAPI", confidence: 0.9, language: "python", runtime: "python" };
    if (lo.includes("flask")) return { slug: "flask", name: "Flask", confidence: 0.9, language: "python", runtime: "python" };
    return { slug: null, name: null, confidence: 0.6, language: "python", runtime: "python" };
  }

  if (files.includes("go.mod")) {
    let goMod = "";
    try { goMod = await readFile(path.join(dirPath, "go.mod"), "utf8"); } catch {}
    if (goMod.includes("github.com/gin-gonic/gin")) return { slug: "gin", name: "Gin", confidence: 0.9, language: "go", runtime: "go" };
    if (goMod.includes("github.com/labstack/echo")) return { slug: "echo", name: "Echo", confidence: 0.9, language: "go", runtime: "go" };
    if (goMod.includes("github.com/gofiber/fiber")) return { slug: "fiber", name: "Fiber", confidence: 0.9, language: "go", runtime: "go" };
    return { slug: "go", name: "Go Application", confidence: 0.8, language: "go", runtime: "go" };
  }

  if (files.includes("Cargo.toml")) {
    let cargo = "";
    try { cargo = await readFile(path.join(dirPath, "Cargo.toml"), "utf8"); } catch {}
    if (cargo.includes("[workspace]")) return null;
    if (cargo.includes("axum")) return { slug: "axum", name: "Axum", confidence: 0.9, language: "rust", runtime: "rust" };
    if (cargo.includes("actix-web")) return { slug: "actix-web", name: "Actix Web", confidence: 0.9, language: "rust", runtime: "rust" };
    return { slug: "rust", name: "Rust Application", confidence: 0.75, language: "rust", runtime: "rust" };
  }

  if (files.includes("artisan")) return { slug: "laravel", name: "Laravel", confidence: 0.95, language: "php", runtime: "php" };
  if (files.includes("composer.json")) {
    let composer = "";
    try { composer = await readFile(path.join(dirPath, "composer.json"), "utf8"); } catch {}
    if (composer.includes("laravel/framework")) return { slug: "laravel", name: "Laravel", confidence: 0.92, language: "php", runtime: "php" };
    if (composer.includes("symfony/framework-bundle")) return { slug: "symfony", name: "Symfony", confidence: 0.92, language: "php", runtime: "php" };
    return { slug: "php", name: "PHP Application", confidence: 0.7, language: "php", runtime: "php" };
  }

  if (files.includes("Gemfile")) {
    let gemfile = "";
    try { gemfile = await readFile(path.join(dirPath, "Gemfile"), "utf8"); } catch {}
    if (gemfile.includes('"rails"') || gemfile.includes("'rails'"))
      return { slug: "rails", name: "Ruby on Rails", confidence: 0.95, language: "ruby", runtime: "ruby" };
    return { slug: "ruby", name: "Ruby Application", confidence: 0.7, language: "ruby", runtime: "ruby" };
  }

  if (files.includes("mix.exs")) {
    let mix = "";
    try { mix = await readFile(path.join(dirPath, "mix.exs"), "utf8"); } catch {}
    if (mix.includes(":phoenix")) return { slug: "phoenix", name: "Phoenix", confidence: 0.95, language: "elixir", runtime: "elixir" };
    return { slug: "elixir", name: "Elixir Application", confidence: 0.8, language: "elixir", runtime: "elixir" };
  }

  if (files.includes("pom.xml") || files.includes("build.gradle") || files.includes("build.gradle.kts")) {
    let manifest = "";
    const mf = ["pom.xml", "build.gradle", "build.gradle.kts"].find(f => files.includes(f));
    if (mf) try { manifest = await readFile(path.join(dirPath, mf), "utf8"); } catch {}
    const isSpring = manifest.includes("spring-boot") || manifest.includes("org.springframework.boot");
    return { slug: isSpring ? "spring-boot" : "java", name: isSpring ? "Spring Boot" : "Java Application", confidence: isSpring ? 0.92 : 0.78, language: "java", runtime: "java" };
  }

  const csproj = files.find(f => f.endsWith(".csproj"));
  if (csproj || files.find(f => f.endsWith(".sln"))) {
    let proj = "";
    if (csproj) try { proj = await readFile(path.join(dirPath, csproj), "utf8"); } catch {}
    const isAsp = proj.includes("Microsoft.AspNetCore") || proj.includes('Sdk="Microsoft.NET.Sdk.Web"');
    return { slug: isAsp ? "aspnet-core" : "dotnet", name: isAsp ? "ASP.NET Core" : ".NET Application", confidence: isAsp ? 0.92 : 0.78, language: "csharp", runtime: "dotnet" };
  }

  const dockerfileFile = files.find(f => f.toLowerCase() === "dockerfile" || f.toLowerCase() === "containerfile");
  if (dockerfileFile) return { slug: null, name: null, confidence: 0.6, language: null, runtime: null };

  return null;
}

function isLikelySharedLib(relPath, confidence) {
  const lower = relPath.toLowerCase();
  const libNames = new Set(["packages", "libs", "shared", "common", "ui", "components", "utils", "helpers", "types", "core"]);
  const last = lower.split("/").pop() ?? "";
  if (libNames.has(last) && confidence < 0.75) return true;
  if ((lower.startsWith("packages/") || lower.startsWith("libs/")) && confidence < 0.8) return true;
  return false;
}

async function runDiscovery(repoRoot, repoName, branch, commitSha) {
  const MAX_DEPTH = 5;
  const MAX_FILES = 5000;
  const warnings = [];
  let fileCount = 0;
  const visited = new Set();
  const candidates = [];

  async function walk(currentPath, depth) {
    if (depth > MAX_DEPTH) return;
    if (fileCount >= MAX_FILES) {
      if (!warnings.includes("Scan limit reached.")) warnings.push("Scan limit reached; some directories were skipped.");
      return;
    }

    let realCurrent;
    try { realCurrent = await realpath(currentPath); } catch { return; }
    let realRoot;
    try { realRoot = await realpath(repoRoot); } catch { realRoot = repoRoot; }
    if (!realCurrent.startsWith(realRoot) || visited.has(realCurrent)) return;
    visited.add(realCurrent);

    let entries;
    try { entries = await readdir(currentPath, { withFileTypes: true }); } catch { return; }

    const files = [];
    const subdirs = [];
    for (const e of entries) {
      fileCount++;
      if (e.isDirectory()) {
        if (!DISCOVERY_IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) subdirs.push(e.name);
      } else if (e.isFile() || e.isSymbolicLink()) {
        files.push(e.name);
      }
    }

    const relPath = currentPath === repoRoot ? "." : path.relative(repoRoot, currentPath).replace(/\\/g, "/");

    if (hasDeployableSignal(files)) {
      const fw = await detectFrameworkForDiscovery(currentPath, files);
      if (fw !== null) {
        const confidence = fw.confidence ?? 0;
        const likelyLib = isLikelySharedLib(relPath, confidence);
        const dockerfileFile = files.find(f => f.toLowerCase() === "dockerfile" || f.toLowerCase() === "containerfile");
        const pkgMgr = detectPkgManager(files);
        const isDeployable = !likelyLib && (confidence > 0.4 || !!dockerfileFile);
        const lastSeg = relPath === "." ? repoName : relPath.split("/").pop();

        candidates.push({
          id: Buffer.from(`${repoName}:${relPath}`).toString("base64").replace(/[+/=]/g, "").slice(0, 16),
          name: lastSeg,
          rootDirectory: relPath,
          framework: fw.slug ?? null,
          frameworkName: fw.name ?? null,
          language: fw.language ?? null,
          runtime: fw.runtime ?? null,
          packageManager: pkgMgr,
          dockerfilePath: dockerfileFile ? (relPath === "." ? dockerfileFile : `${relPath}/${dockerfileFile}`) : undefined,
          confidence,
          warnings: [],
          isDeployable,
        });
      }
    }

    for (const sub of subdirs) {
      await walk(path.join(currentPath, sub), depth + 1);
    }
  }

  await walk(repoRoot, 0);

  const deployable = candidates.filter(c => c.isDeployable).sort((a, b) => {
    const cd = b.confidence - a.confidence;
    if (Math.abs(cd) > 0.05) return cd;
    const da = a.rootDirectory === "." ? 0 : a.rootDirectory.split("/").length;
    const db2 = b.rootDirectory === "." ? 0 : b.rootDirectory.split("/").length;
    return da - db2;
  });
  const nonDeployable = candidates.filter(c => !c.isDeployable);
  const ranked = [...deployable, ...nonDeployable];

  let recommendedRootDirectory = null;
  let requiresUserSelection = false;
  if (deployable.length === 1) {
    recommendedRootDirectory = deployable[0].rootDirectory;
  } else if (deployable.length > 1) {
    const [first, second] = deployable;
    recommendedRootDirectory = first.rootDirectory;
    if (first.confidence - second.confidence <= 0.15) requiresUserSelection = true;
  }

  let rootFiles = [];
  try { rootFiles = (await readdir(repoRoot, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name); } catch {}
  const isMonorepo = rootFiles.includes("pnpm-workspace.yaml") || rootFiles.includes("turbo.json")
    || rootFiles.includes("nx.json") || rootFiles.includes("lerna.json") || deployable.length > 1;

  return {
    repository: { name: repoName, branch, commitSha: commitSha ?? null },
    monorepo: isMonorepo,
    candidates: ranked,
    recommendedRootDirectory,
    requiresUserSelection,
    discoveryVersion: DISCOVERY_VERSION,
    warnings,
  };
}

async function resolveAppRoot(clonedRepoDir, rootDirectory) {
  if (!rootDirectory || rootDirectory === ".") return clonedRepoDir;
  const normalized = discoveryNormalizePath(rootDirectory);
  const abs = path.resolve(clonedRepoDir, normalized);
  if (!abs.startsWith(path.resolve(clonedRepoDir))) {
    throw new Error(`rootDirectory escapes the repository: ${rootDirectory}`);
  }
  let s;
  try { s = await stat(abs); } catch (err) {
    if (err.code === "ENOENT") throw new Error(`rootDirectory not found: ${rootDirectory}`);
    throw err;
  }
  if (!s.isDirectory()) throw new Error(`rootDirectory is not a directory: ${rootDirectory}`);
  return abs;
}


async function readDockerfilePort(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    const matches = [...contents.matchAll(/^\s*EXPOSE\s+(.+)$/gim)];
    let port = null;
    for (const match of matches) {
      for (const token of match[1].split(/\s+/)) {
        const value = Number(token.replace(/\/.*$/, ""));
        if (Number.isInteger(value) && value > 0 && value < 65536) port = value;
      }
    }
    return port;
  } catch {
    return null;
  }
}

async function prepareRailpack(appDir, workDir, onLine, cacheKey) {
  const planPath = path.join(workDir, "railpack-plan.json");
  const infoPath = path.join(workDir, "railpack-info.json");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    onLine("system", `Running railpack prepare (attempt ${attempt} of 3).`);
    const result = await runCommand(
      config.railpackBin,
      ["prepare", appDir, "--plan-out", planPath, "--info-out", infoPath],
      {
        timeoutMs: 10 * 60 * 1000,
        onLine: (_stream, line) => onLine("stdout", line),
      },
    );

    if (result.error) {
      throw new Error(`Railpack is not available on the builder: ${result.error.message}`);
    }

    const info = await readInfo(infoPath);
    const retryable = result.code === 75 || result.code === null;

    if (result.code === 0 && info.success) {
      await rewriteRailpackPlan(planPath, config.railpackBuilderImage, cacheKey);
      return { planPath, ...info };
    }
    if (retryable) {
      onLine("system", "Railpack hit a transient error; retrying.");
      await sleep(2_000 * attempt);
      continue;
    }
    return {
      planPath,
      ...info,
      success: false,
      error:
        info.error ??
        `Railpack could not plan this application (exit ${result.code ?? result.signal ?? "unknown"}).`,
    };
  }

  const info = await readInfo(infoPath);
  return {
    planPath,
    ...info,
    success: false,
    error: info.error ?? "Railpack planning failed after multiple attempts.",
  };
}

async function ensureRegistryAuth() {
  if (!config.registry || !config.registryUsername || !config.registryPassword) {
    return;
  }
  const host = config.registry.split("/")[0];
  const auth = Buffer.from(
    `${config.registryUsername}:${config.registryPassword}`,
  ).toString("base64");
  const dockerDir = path.join(os.homedir(), ".docker");
  await mkdir(dockerDir, { recursive: true });
  await writeFile(
    path.join(dockerDir, "config.json"),
    JSON.stringify({ auths: { [host]: { auth } } }),
    { mode: 0o600 },
  );
}

function railpackOpts(cacheKey) {
  const opts = ["--opt", `source=${config.frontendImage}`];
  if (cacheKey) opts.push("--opt", `build-arg:cache-key=${cacheKey}`);
  if (config.githubToken) opts.push("--opt", `build-arg:github-token=${config.githubToken}`);
  return opts;
}

async function buildImage({ strategy, appDir, workDir, planPath, imageRef, cacheKey, onLine }) {
  await ensureRegistryAuth();

  if (config.buildkitHost) {
    const args = [
      "--addr",
      config.buildkitHost,
      "build",
      "--local",
      `context=${appDir}`,
      "--output",
      // Layer compression is CPU-bound and dominates cold builds on the small
      // builder VM; level 1 trades a little size for a large speed-up. Warm
      // layers are reused from the BuildKit cache, so this only affects new
      // layers.
      `type=image,name=${imageRef},push=true,compression=gzip,compression-level=1`,
    ];

    if (strategy.dockerfile) {
      args.push(
        "--local",
        `dockerfile=${appDir}`,
        "--opt",
        `filename=${strategy.dockerfile}`,
      );
    } else {
      args.push(
        "--local",
        `dockerfile=${workDir}`,
        "--frontend=gateway.v0",
        ...railpackOpts(cacheKey),
      );
    }

    const result = await runCommand("buildctl", args, {
      timeoutMs: config.maxBuildMs,
      onLine: (_stream, line) => onLine("stdout", line),
    });
    if (result.error) throw new Error(`buildctl is not available: ${result.error.message}`);
    if (result.code !== 0) {
      throw new Error(`BuildKit build failed (exit ${result.code ?? result.signal ?? "unknown"}).`);
    }
    return;
  }

  const args = ["buildx", "build", "--push", "-t", imageRef];
  if (strategy.dockerfile) {
    args.push("-f", path.join(appDir, strategy.dockerfile));
  } else {
    args.push(
      "--build-arg",
      `BUILDKIT_SYNTAX=${config.frontendImage}`,
      "-f",
      planPath,
    );
    if (cacheKey) args.push("--build-arg", `cache-key=${cacheKey}`);
    if (config.githubToken) {
      args.push("--build-arg", `github-token=${config.githubToken}`);
    }
  }
  args.push(appDir);

  const result = await runCommand("docker", args, {
    timeoutMs: config.maxBuildMs,
    onLine: (_stream, line) => onLine("stdout", line),
  });
  if (result.error) {
    throw new Error(
      "Docker is not available on the builder. Set BUILDKIT_HOST to use buildctl instead.",
    );
  }
  if (result.code !== 0) {
    throw new Error(`Docker build failed (exit ${result.code ?? result.signal ?? "unknown"}).`);
  }
}

/* ------------------------------------------------------------------ */
/* Job orchestration                                                   */
/* ------------------------------------------------------------------ */

/**
 * Drop per-deployment exec cache mounts (npm/pnpm/yarn/pip/uv, apt, etc.)
 * after a build. The `cache-key` build arg already namespaces them per
 * deployment, but they would otherwise accumulate on the persistent volume.
 *
 * We do NOT run a blanket `buildctl prune` here. Doing so would also evict
 * the `packages:mise` and `packages:apt` layer snapshots (they become
 * reclaimable the moment the build finishes and no active build holds them),
 * forcing mise/apt to reinstall on every deployment. Instead, BuildKit's own
 * GC (`--oci-worker-gc-keepstorage`) handles volume pressure automatically.
 * User app layers (`install`, `build`) are never reused across deployments
 * because the per-deployment `cloudisy-nocache:<deploymentId>` marker gives
 * each build a unique hash — no explicit prune is needed for them.
 *
 * Best-effort: failures are logged and never fail a build.
 */
async function pruneBuildCache() {
  if (!config.buildkitHost) return;
  const result = await runCommand(
    "buildctl",
    ["--addr", config.buildkitHost, "prune", "--filter", "type==exec.cachemount"],
    { timeoutMs: 120_000 },
  );
  if (result.error) {
    log(`warning: could not prune BuildKit exec cache mounts: ${result.error.message}`);
  } else if (result.code !== 0) {
    log(`warning: BuildKit exec cache prune exited ${result.code ?? result.signal}`);
  } else {
    log("pruned BuildKit exec cache mounts");
  }
}

const queue = [];
let active = null;
let idleTimer = null;

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  if (active || queue.length > 0) return;
  idleTimer = setTimeout(() => {
    log("idle timeout reached; stopping");
    process.exit(0);
  }, config.idleTimeoutMs);
  idleTimer.unref?.();
}

async function runBuild(job) {
  const sink = new LogSink(job.deploymentId);
  sink.start();

  const onLine = (stream, line) => {
    sink.push(stream, line);
    if (stream === "system") log(line);
  };

  let stage = "preparing";
  const heartbeat = setInterval(() => {
    sendStatus(job.deploymentId, stage).catch(() => {});
  }, 60_000);
  heartbeat.unref?.();

  const jobDir = path.join(config.workspaceDir, job.deploymentId);
  const appDir = path.join(jobDir, "app");
  const workDir = path.join(jobDir, "build");

  try {
    await mkdir(workDir, { recursive: true });
    await sendStatus(job.deploymentId, "preparing");
    onLine("system", `Cloning ${job.repoUrl} (branch ${job.branch}).`);
    const commitSha = await cloneRepo(job, appDir, onLine);
    onLine(
      "system",
      commitSha ? `Checked out commit ${commitSha.slice(0, 12)}.` : "Repository cloned.",
    );

    onLine("system", "[Discovery] Scanning repository…");
    const discoverySummary = await runDiscovery(appDir, "app", job.branch, commitSha).catch(() => null);
    if (discoverySummary) {
      if (discoverySummary.monorepo) {
        onLine("system", "[Discovery] Monorepo detected.");
      }
      onLine(
        "system",
        `[Discovery] Found ${discoverySummary.candidates.length} application(s).`,
      );
    }

    // Resolve the application root directory (from discovery or default to repo root)
    const buildRoot = await resolveAppRoot(appDir, job.rootDirectory ?? null);
    const activeCandidate = discoverySummary?.candidates.find(
      (c) => c.rootDirectory === (job.rootDirectory ?? ".")
    );
    if (activeCandidate?.frameworkName) {
      onLine("system", `[Discovery] Framework: ${activeCandidate.frameworkName}`);
    }
    onLine("system", `[Discovery] Root directory: ${job.rootDirectory ?? "."}`);
    if (activeCandidate?.packageManager) {
      onLine("system", `[Discovery] Package manager: ${activeCandidate.packageManager}`);
    }

    let strategy = await detectStrategy(buildRoot);
    let internalPort = config.defaultInternalPort;
    let planPath = null;
    let useRailpack = false;

    if (strategy.dockerfile) {
      onLine("system", `Using Dockerfile: ${strategy.dockerfile}`);
      internalPort =
        (await readDockerfilePort(path.join(buildRoot, strategy.dockerfile))) ??
        internalPort;
    } else {
      onLine("system", "No Dockerfile found; using Railpack.");
      useRailpack = true;
    }

    stage = "building";
    await sendStatus(job.deploymentId, "building");

    while (true) {
      if (useRailpack) {
        const prepared = await prepareRailpack(buildRoot, workDir, onLine, job.deploymentId);
        for (const line of prepared.logs) sink.push("stdout", line);
        if (!prepared.success) {
          throw new Error(prepared.error ?? "Railpack could not plan this application.");
        }
        if (prepared.provider) onLine("system", `Detected provider: ${prepared.provider}`);
        if (prepared.internalPort) internalPort = prepared.internalPort;
        planPath = prepared.planPath;
        strategy = { dockerfile: null };
      }

      onLine(
        "system",
        useRailpack
          ? `Building and pushing image ${job.imageRef} with Railpack.`
          : `Building and pushing image ${job.imageRef} with the repository Dockerfile.`,
      );
      try {
        await buildImage({
          strategy,
          appDir: buildRoot,
          workDir,
          planPath,
          imageRef: job.imageRef,
          cacheKey: job.deploymentId,
          onLine,
        });
        break;
      } catch (error) {
        if (useRailpack) throw error;
        onLine(
          "system",
          `Dockerfile build failed (${
            error instanceof Error ? error.message : "unknown error"
          }); falling back to Railpack.`,
        );
        useRailpack = true;
      }
    }

    stage = "pushing";
    await sendStatus(job.deploymentId, "pushing");
    onLine("system", "Image pushed to the registry.");

    const accepted = await callControlPlane(
      `/api/v1/internal/deployments/${job.deploymentId}/complete`,
      {
        imageRef: job.imageRef,
        internalPort,
        ...(commitSha ? { commitSha } : {}),
      },
      1,
      180_000,
    );
    if (!accepted.ok) {
      throw new Error(`The control plane did not accept the build result (${accepted.error}).`);
    }
    onLine("system", "Build complete.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Build failed.";
    sink.push("stderr", message);
    sink.push("system", "Build failed.");
    await sendStatus(job.deploymentId, "failed", { errorMessage: message });
    throw error;
  } finally {
    clearInterval(heartbeat);
    await sink.close();
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
    // Never let user package/source caches persist on the volume between
    // deployments; the workspace dir above already holds the clone only for
    // the duration of this job.
    await pruneBuildCache().catch((error) => {
      log(`warning: BuildKit prune failed: ${error?.message ?? error}`);
    });
  }
}

async function processNext() {
  if (active) return;
  const job = queue.shift();
  if (!job) {
    scheduleIdle();
    return;
  }
  active = job;
  log(`starting build ${job.deploymentId} (${queue.length} queued)`);
  try {
    await runBuild(job);
    log(`build ${job.deploymentId} finished`);
  } catch (error) {
    log(`build ${job.deploymentId} failed: ${error?.message ?? error}`);
  } finally {
    active = null;
    processNext();
  }
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorized(request) {
  if (!config.builderApiToken) return false;
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(config.builderApiToken);
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

function readBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function validateJob(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object") throw new Error("Invalid job payload.");

  const { deploymentId, repoUrl, branch, imageRef, buildNumber } = body;

  if (typeof deploymentId !== "string" || !UUID_RE.test(deploymentId)) {
    throw new Error("Invalid deploymentId.");
  }
  let url;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error("Invalid repoUrl.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid repoUrl.");
  }
  if (
    typeof branch !== "string" ||
    !/^[A-Za-z0-9._\-\/]+$/.test(branch) ||
    branch.startsWith("-")
  ) {
    throw new Error("Invalid branch.");
  }
  if (
    typeof imageRef !== "string" ||
    !/^[a-z0-9.\-]+(?::\d+)?\/[a-z0-9._\-\/]+:[A-Za-z0-9._\-]+$/.test(imageRef)
  ) {
    throw new Error("Invalid imageRef.");
  }
  if (!Number.isInteger(buildNumber) || buildNumber < 1) {
    throw new Error("Invalid buildNumber.");
  }

  // Optional discovery fields
  const rootDirectory = typeof body.rootDirectory === "string" && body.rootDirectory
    ? body.rootDirectory
    : null;
  if (rootDirectory && (rootDirectory.includes("..") || rootDirectory.startsWith("/"))) {
    throw new Error("Invalid rootDirectory.");
  }
  const commitSha = typeof body.commitSha === "string" && /^[0-9a-f]{7,64}$/.test(body.commitSha)
    ? body.commitSha
    : null;

  return { deploymentId, repoUrl, branch, imageRef, buildNumber, rootDirectory, commitSha };
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    json(response, 200, {
      ok: true,
      busy: active !== null,
      queued: queue.length,
      uptimeSeconds: Math.floor(process.uptime()),
    });
    return;
  }

  // Readiness probe used by the control plane before dispatching a job. It
  // verifies BuildKit itself is reachable, not just this HTTP server, so a job
  // is never handed to a machine whose buildkitd is still starting.
  if (request.method === "GET" && url.pathname === "/ready") {
    let buildkitReady = true;
    if (config.buildkitHost) {
      const result = await runCommand(
        "buildctl",
        ["--addr", config.buildkitHost, "debug", "workers"],
        { timeoutMs: 5_000 },
      );
      buildkitReady = !result.error && result.code === 0;
    }
    json(response, buildkitReady ? 200 : 503, { ready: buildkitReady });
    return;
  }

  if (request.method === "POST" && url.pathname === "/discover") {
    if (!authorized(request)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    let discoverBody;
    try {
      const raw = await readBody(request);
      discoverBody = JSON.parse(raw);
    } catch {
      json(response, 400, { error: "Invalid request body." });
      return;
    }
    const { repositoryUrl, branch, commitSha: inputSha } = discoverBody ?? {};
    if (typeof repositoryUrl !== "string" || !repositoryUrl.startsWith("https://github.com/")) {
      json(response, 400, { error: "Invalid repositoryUrl." });
      return;
    }
    if (typeof branch !== "string" || !/^[A-Za-z0-9._\-\/]+$/.test(branch)) {
      json(response, 400, { error: "Invalid branch." });
      return;
    }

    const discoverJobId = `discover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const discoverDir = path.join(config.workspaceDir, discoverJobId, "repo");
    try {
      await mkdir(discoverDir, { recursive: true });
      log(`[Discover] Cloning ${repositoryUrl} branch ${branch}`);

      // Clone the repo (shallow)
      const cloneResult = await runCommand(
        "git",
        ["clone", "--depth", "1", "--single-branch", `--branch=${branch}`, repositoryUrl, discoverDir],
        { timeoutMs: 3 * 60 * 1000, env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true" } },
      );
      if (cloneResult.code !== 0) {
        json(response, 422, { error: "Repository clone failed.", detail: cloneResult.stderr.slice(0, 500) });
        return;
      }

      // Resolve actual SHA
      const headResult = await runCommand("git", ["rev-parse", "HEAD"], { cwd: discoverDir, timeoutMs: 10_000 });
      const resolvedSha = headResult.code === 0 && headResult.stdout ? headResult.stdout.trim() : (inputSha ?? null);

      // Extract repo name from URL
      const urlParts = repositoryUrl.replace(/\/+$/, "").split("/");
      const repoName = urlParts[urlParts.length - 1] || "repository";

      log(`[Discover] Running discovery on ${repoName}`);
      const result = await runDiscovery(discoverDir, repoName, branch, resolvedSha);
      log(`[Discover] Found ${result.candidates.length} candidates`);

      json(response, 200, result);
    } catch (error) {
      log(`[Discover] Error: ${error?.message ?? error}`);
      json(response, 500, { error: error?.message ?? "Discovery failed." });
    } finally {
      await rm(path.join(config.workspaceDir, discoverJobId), { recursive: true, force: true }).catch(() => {});
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/builds") {
    if (!authorized(request)) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    let job;
    try {
      job = validateJob(await readBody(request));
    } catch (error) {
      json(response, 400, { error: error?.message ?? "invalid job" });
      return;
    }
    queue.push(job);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    const position = queue.length + (active ? 1 : 0);
    json(response, 202, { accepted: true, position });
    log(`queued build ${job.deploymentId} (position ${position})`);
    processNext();
    return;
  }

  json(response, 404, { error: "not_found" });
});

const isMain = Boolean(
  process.env.NODE_ENV !== "test" &&
    process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]),
);

if (isMain) {
  server.listen(config.port, "0.0.0.0", () => {
    log(`listening on :${config.port}`);
    log(
      `mode: ${config.buildkitHost ? `buildctl (${config.buildkitHost})` : "docker buildx"}`,
    );
    if (!config.builderApiToken) log("WARNING: BUILDER_API_TOKEN is not set; all jobs will be rejected");
    if (!config.registry) log("WARNING: OCI_REGISTRY is not set; image pushes will fail");
    scheduleIdle();
  });

  function shutdown(signal) {
    log(`received ${signal}; shutting down`);
    server.close();
    if (!active) process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export {
  rewriteRailpackPlan,
  prepareRailpack,
  UPSTREAM_RAILPACK_BUILDER_RE,
};
