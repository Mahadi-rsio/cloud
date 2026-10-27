type Env = {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  FLY_API_TOKEN?: string;
  FLY_ORG_SLUG?: string;
  FLY_DEFAULT_REGION?: string;
  FLY_DEFAULT_IMAGE?: string;

  // Build control plane → shared builder machine
  BUILDER_URL?: string;
  BUILDER_API_TOKEN?: string;
  BUILDER_APP_NAME?: string;
  BUILDER_MACHINE_ID?: string;

  // Builder machine → control plane callbacks
  INTERNAL_API_TOKEN?: string;
  CONTROL_PLANE_URL?: string;

  // OCI registry the builder pushes images to
  OCI_REGISTRY?: string;
  OCI_REGISTRY_USERNAME?: string;
  OCI_REGISTRY_PASSWORD?: string;

  // Build tuning
  BUILD_IDLE_TIMEOUT_MS?: string;
  BUILD_MAX_ATTEMPTS?: string;
  BUILD_WORKSPACE_DIR?: string;
  BUILD_DEFAULT_INTERNAL_PORT?: string;

  // Optional GitHub API token (raises rate limits; never required for public repos)
  GITHUB_API_TOKEN?: string;
};

const KEYS: (keyof Env)[] = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "FLY_API_TOKEN",
  "FLY_ORG_SLUG",
  "FLY_DEFAULT_REGION",
  "FLY_DEFAULT_IMAGE",
  "BUILDER_URL",
  "BUILDER_API_TOKEN",
  "BUILDER_APP_NAME",
  "BUILDER_MACHINE_ID",
  "INTERNAL_API_TOKEN",
  "CONTROL_PLANE_URL",
  "OCI_REGISTRY",
  "OCI_REGISTRY_USERNAME",
  "OCI_REGISTRY_PASSWORD",
  "BUILD_IDLE_TIMEOUT_MS",
  "BUILD_MAX_ATTEMPTS",
  "BUILD_WORKSPACE_DIR",
  "BUILD_DEFAULT_INTERNAL_PORT",
  "GITHUB_API_TOKEN",
];

let cached: Env | undefined;

function fromRecord(source: Record<string, unknown>): Env {
  const env: Env = {};
  for (const key of KEYS) {
    const value = source[key];
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export async function getEnv(): Promise<Env> {
  if (cached) return cached;
  try {
    const { env } = await import("cloudflare:workers");
    if (env?.DATABASE_URL) {
      cached = fromRecord(env as Record<string, unknown>);
      return cached;
    }
  } catch {
    // not running on Cloudflare
  }
  cached = fromRecord(process.env as Record<string, unknown>);
  return cached;
}

export function buildDefaultInternalPort(env: Env): number {
  const parsed = Number(env.BUILD_DEFAULT_INTERNAL_PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 8080;
}

export function buildMaxAttempts(env: Env): number {
  const parsed = Number(env.BUILD_MAX_ATTEMPTS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 3;
}

export function buildIdleTimeoutMs(env: Env): number {
  const parsed = Number(env.BUILD_IDLE_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000;
}