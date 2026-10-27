import { startFlyMachine } from "@/lib/fly/client";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";

export type BuildJobPayload = {
  deploymentId: string;
  repoUrl: string;
  branch: string;
  imageRef: string;
  buildNumber: number;
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
 * Wake the shared builder machine and wait until its health endpoint answers.
 * The machine is explicitly started here (not via Fly Proxy autostop) and is
 * stopped by its own idle timer once it has been quiet for long enough.
 */
export async function ensureBuilderAwake(): Promise<void> {
  const env = await getEnv();
  if (!env.BUILDER_URL) return;

  if (env.BUILDER_APP_NAME && env.BUILDER_MACHINE_ID) {
    try {
      await startFlyMachine(env.BUILDER_APP_NAME, env.BUILDER_MACHINE_ID);
    } catch {
      // Already running, or not permitted to start — the health probe decides.
    }
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${builderBaseUrl(env.BUILDER_URL)}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
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