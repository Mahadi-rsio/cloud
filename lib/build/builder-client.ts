import { startFlyMachine } from "@/lib/fly/client";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export type BuildJobPayload = {
  deploymentId: string;
  repoUrl: string;
  branch: string;
  imageRef: string;
  buildNumber: number;
  /** Relative path within the repository to use as build context (e.g. "apps/web"). Defaults to ".". */
  rootDirectory?: string;
  /** Exact commit SHA resolved during discovery. When set, the builder checks out this SHA. */
  commitSha?: string;
};

export type DiscoverPayload = {
  repositoryUrl: string;
  branch: string;
  commitSha?: string;
};

function builderBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OCI image reference for a deployment build, e.g.
 * ghcr.io/acme/dep-<deploymentId>:b1. The image is pushed into the deployment
 * app's own namespace, which Fly requires (`registry.fly.io/<app>:<tag>`
 * only accepts repositories that match a real app).
 */
export function buildImageRef(input: {
  registry: string;
  appName: string;
  buildNumber: number;
}): string {
  const registry = input.registry.replace(/\/+$/, "");
  return `${registry}/${input.appName}:b${input.buildNumber}`;
}

/**
 * Best-effort start of the shared builder machine. Called as soon as a deploy
 * request arrives (before the job is queued) so the machine boots while the
 * request is still being processed. Never throws.
 */
export async function wakeBuilder(): Promise<void> {
  const env = await getEnv();
  if (!env.BUILDER_URL) return;
  if (!env.BUILDER_APP_NAME || !env.BUILDER_MACHINE_ID) return;
  try {
    await startFlyMachine(env.BUILDER_APP_NAME, env.BUILDER_MACHINE_ID);
  } catch {
    // Already running, or not permitted to start — the readiness probe decides.
  }
}

/**
 * Wake the shared builder machine and wait until it is ready to accept work.
 * Readiness means BuildKit itself answers (`/ready` runs `buildctl debug
 * workers`), not just that the HTTP server is up, so a job is never handed to a
 * machine whose buildkitd is still starting. The machine is explicitly started
 * here (not via Fly Proxy autostop) and is stopped by its own idle timer once
 * it has been quiet for long enough.
 */
export async function ensureBuilderAwake(): Promise<void> {
  const env = await getEnv();
  if (!env.BUILDER_URL) return;

  await wakeBuilder();

  const base = builderBaseUrl(env.BUILDER_URL);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const ready = await fetch(`${base}/ready`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (ready.ok) return;
      if (ready.status === 404) {
        // Older builder without /ready: fall back to the liveness endpoint.
        const health = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (health.ok) return;
      }
    } catch {
      // not reachable yet
    }
    await sleep(2_000);
  }

  throw new HttpError(
    "PROVIDER_ERROR",
    "The build service did not become ready in time. Please try again.",
    502,
  );
}

/** Hand a build job to the shared builder machine. */
export async function dispatchBuild(payload: BuildJobPayload): Promise<void> {
  const env = await getEnv();
  if (!env.BUILDER_URL) {
    throw new HttpError(
      "PROVIDER_ERROR",
      "BUILDER_URL is not configured. Set it to the shared build service URL.",
      500,
    );
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.BUILDER_API_TOKEN) {
    headers.set("Authorization", `Bearer ${env.BUILDER_API_TOKEN}`);
  }

  let response: Response;
  try {
    response = await fetch(`${builderBaseUrl(env.BUILDER_URL)}/builds`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(
      "PROVIDER_ERROR",
      "Could not reach the build service. Please try again.",
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(
      "PROVIDER_ERROR",
      `The build service rejected the job (status ${response.status}).`,
      502,
      body.slice(0, 500),
    );
  }
}

/**
 * Call the builder's /discover endpoint to analyze a repository.
 * Returns the raw discovery result JSON.
 */
export async function callBuilderDiscover(payload: DiscoverPayload): Promise<unknown> {
  const env = await getEnv();
  if (!env.BUILDER_URL) {
    throw new HttpError(
      "PROVIDER_ERROR",
      "BUILDER_URL is not configured.",
      500,
    );
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  if (env.BUILDER_API_TOKEN) {
    headers.set("Authorization", `Bearer ${env.BUILDER_API_TOKEN}`);
  }

  let response: Response;
  try {
    response = await fetch(`${builderBaseUrl(env.BUILDER_URL)}/discover`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      // Discovery clones the repo, so allow up to 3 minutes
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new HttpError(
      "PROVIDER_ERROR",
      "Could not reach the build service. Please try again.",
      502,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(
      "PROVIDER_ERROR",
      `Discovery failed (status ${response.status}): ${body.slice(0, 300)}`,
      502,
    );
  }

  return response.json();
}