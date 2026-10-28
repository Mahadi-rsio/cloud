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
 *   GITHUB_TOKEN             optional token to raise GitHub rate limits
 *   ENABLE_BUILDKITD         entrypoint hint only
 */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

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

async function callControlPlane(pathname, body, retries = 2) {
  if (!config.controlPlaneUrl || !config.internalToken) {
    log(`cannot call ${pathname}: CONTROL_PLANE_URL/INTERNAL_API_TOKEN missing`);
    return false;
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
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return true;
      const text = await response.text().catch(() => "");
      lastError = new Error(`status ${response.status}: ${text.slice(0, 300)}`);
      if (response.status >= 400 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    if (attempt < retries) await sleep(1_000 * (attempt + 1));
  }
  log(`callback ${pathname} failed: ${lastError?.message ?? "unknown error"}`);
  return false;
}

function sendStatus(deploymentId, status, extra = {}) {
  return callControlPlane(
    `/api/v1/internal/deployments/${deploymentId}/status`,
    { status, ...extra },
    1,
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

async function prepareRailpack(appDir, workDir, onLine) {
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
      `type=image,name=${imageRef},push=true`,
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

    let strategy = await detectStrategy(appDir);
    let internalPort = config.defaultInternalPort;
    let planPath = null;
    let useRailpack = false;

    if (strategy.dockerfile) {
      onLine("system", `Using Dockerfile: ${strategy.dockerfile}`);
      internalPort =
        (await readDockerfilePort(path.join(appDir, strategy.dockerfile))) ??
        internalPort;
    } else {
      onLine("system", "No Dockerfile found; using Railpack.");
      useRailpack = true;
    }

    stage = "building";
    await sendStatus(job.deploymentId, "building");

    while (true) {
      if (useRailpack) {
        const prepared = await prepareRailpack(appDir, workDir, onLine);
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
          appDir,
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
      3,
    );
    if (!accepted) {
      throw new Error("The control plane did not accept the build result.");
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

  return { deploymentId, repoUrl, branch, imageRef, buildNumber };
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
