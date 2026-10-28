/**
 * Railpack command construction and result parsing.
 *
 * Production flow (per the Railpack operator guide):
 *
 *   1. `railpack prepare <dir> --plan-out plan.json --info-out info.json`
 *   2. `docker buildx build --build-arg BUILDKIT_SYNTAX=<frontend> -f plan.json --push -t <image> <dir>`
 *
 * We use the BuildKit frontend (not the `railpack build` CLI) because it is
 * the recommended path for platforms and lets us push straight to a registry.
 *
 * Exit codes from `prepare`:
 *   - 0  → success
 *   - 75 → transient failure (network, Mise download); retry
 *   - 1  → permanent failure (no provider, missing start command); fail
 *   - no code → the process never ran; retry
 */

export const RAILPACK_FRONTEND_IMAGE = "ghcr.io/railwayapp/railpack-frontend";

/**
 * Builder image Railpack pins into generated plans. The worker bakes its own
 * copy with common runtimes preinstalled (builder/railpack/Dockerfile) and
 * rewrites every plan to use it instead.
 */
export const RAILPACK_BUILDER_IMAGE = "ghcr.io/railwayapp/railpack-builder";
const RAILPACK_BUILDER_IMAGE_RE = /^ghcr\.io\/railwayapp\/railpack-builder:/;

/**
 * Rewrite a generated Railpack plan so builds use our baked builder image and
 * prune the runtimes the app does not need before the deploy image is built:
 *
 *  - Every step input that references the upstream builder image (the
 *    `packages:mise` step and the `install_bin` helper) is pointed at
 *    `builderImage`.
 *  - The `packages:mise` step gets `mise prune --yes` appended after `mise
 *    install`. Pruning with `--prune`/`--yes` removes the runtimes baked into
 *    the builder image that the app's /etc/mise/config.toml does not request,
 *    so node/python deploy images (which copy the whole /mise/installs tree)
 *    stay small.
 *
 * Returns the (mutated) plan for convenience. When `builderImage` is the
 * upstream image this is a no-op apart from the prune step.
 */
export function rewriteRailpackPlan(
  plan: {
    steps?: Array<{
      name?: string;
      inputs?: Array<{ image?: string }>;
      commands?: Array<{ cmd?: string; customName?: string }>;
    }>;
  },
  builderImage: string,
) {
  const steps = plan.steps ?? [];
  for (const step of steps) {
    for (const input of step.inputs ?? []) {
      if (input.image && RAILPACK_BUILDER_IMAGE_RE.test(input.image)) {
        input.image = builderImage;
      }
    }
    if (step.name !== "packages:mise") continue;
    const commands = step.commands ?? [];
    const installIndex = commands.findIndex((command) => command.cmd === "mise install");
    if (installIndex === -1) continue;
    if (commands.some((command) => command.cmd === "mise prune --yes")) continue;
    commands.push({ cmd: "mise prune --yes", customName: "prune unused runtimes" });
  }
  return plan;
}

export function railpackPrepareArgs(input: {
  directory: string;
  planOut: string;
  infoOut: string;
}): string[] {
  return [
    "prepare",
    input.directory,
    "--plan-out",
    input.planOut,
    "--info-out",
    input.infoOut,
  ];
}

export type DockerBuildxInput = {
  contextDirectory: string;
  imageRef: string;
  /** Path to the Railpack plan (enables the custom frontend). */
  planPath?: string;
  dockerfile?: string;
  cacheKey?: string;
  secretsHash?: string;
  /** Registry cache, e.g. `type=registry,ref=ghcr.io/org/app:cache`. */
  cacheFrom?: string;
  cacheTo?: string;
  platform?: string;
};

/**
 * Build a `docker buildx build --push` argument list. When `planPath` is
 * present the Railpack BuildKit frontend is selected; otherwise a plain
 * Dockerfile build is produced.
 */
export function dockerBuildxArgs(input: DockerBuildxInput): string[] {
  const args = ["buildx", "build", "--push", "-t", input.imageRef];

  if (input.planPath) {
    args.push(
      "--build-arg",
      `BUILDKIT_SYNTAX=${RAILPACK_FRONTEND_IMAGE}`,
      "-f",
      input.planPath,
    );
    if (input.cacheKey) {
      args.push("--build-arg", `cache-key=${input.cacheKey}`);
    }
    if (input.secretsHash) {
      args.push("--build-arg", `secrets-hash=${input.secretsHash}`);
    }
  } else if (input.dockerfile) {
    args.push("-f", input.dockerfile);
  }

  if (input.platform) args.push("--platform", input.platform);
  if (input.cacheFrom) args.push("--cache-from", input.cacheFrom);
  if (input.cacheTo) args.push("--cache-to", input.cacheTo);

  args.push(input.contextDirectory);
  return args;
}

export type PrepareExitAction = "success" | "retry" | "fail";

export function classifyPrepareExit(code: number | null | undefined): PrepareExitAction {
  if (code === 0) return "success";
  if (code === null || code === undefined) return "retry";
  if (code === 75) return "retry";
  return "fail";
}

export type RailpackInfo = {
  success: boolean;
  provider: string | null;
  startCommand: string | null;
  internalPort: number | null;
  logs: string[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return asString(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = asString(item);
      if (found) return found;
    }
  }
  return null;
}

function asPort(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const port = Number(value);
    return port > 0 && port < 65536 ? port : null;
  }
  return null;
}

function firstPort(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const port = asPort(item);
      if (port) return port;
    }
    return null;
  }
  return asPort(value);
}

/**
 * Best-effort parse of `railpack-info.json`. Railpack's info file is written
 * even on failure (`{ success: false, logs: [...] }`), so we read the success
 * flag and logs from there instead of scraping stdout.
 */
export function parseRailpackInfo(raw: unknown): RailpackInfo {
  const info = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const logs: string[] = [];
  if (Array.isArray(info.logs)) {
    for (const entry of info.logs) {
      if (typeof entry === "string") logs.push(entry);
      else if (entry && typeof entry === "object") {
        const message = asString((entry as Record<string, unknown>).message);
        if (message) logs.push(message);
      }
    }
  }

  const buildPorts =
    info.build && typeof info.build === "object"
      ? (info.build as Record<string, unknown>).ports
      : undefined;

  const internalPort =
    firstPort(info.ports) ??
    firstPort(info.internalPort) ??
    firstPort(info.internal_port) ??
    firstPort(buildPorts);

  return {
    success: info.success !== false,
    provider: firstString(info.provider) ?? firstString(info.providers),
    startCommand:
      firstString(info.startCommand) ??
      firstString(info.start_command) ??
      firstString(info.start),
    internalPort,
    logs,
  };
}