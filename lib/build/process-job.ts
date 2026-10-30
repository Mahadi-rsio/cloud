import {
  buildImageRef,
  dispatchBuild,
  ensureBuilderAwake,
} from "@/lib/build/builder-client";
import {
  appendDeploymentLogs,
  appendSystemLog,
  ensureDeploymentFlyApp,
  findDeployment,
  markDeploymentFailed,
  setDeploymentStatus,
} from "@/lib/build/deployments-service";
import { buildMaxAttempts, getEnv } from "@/lib/env";

export type DeployJob = {
  type: "deploy-build";
  deploymentId: string;
};

export async function enqueueDeployJob(job: DeployJob) {
  try {
    const { env } = await import("cloudflare:workers");
    await env.BUILD_JOBS.send(job);
  } catch {
    // No queue binding outside a Workers runtime (plain `next dev`).
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "The build job could not be dispatched.";
}

/**
 * Queue consumer for `deploy-build` jobs.
 *
 * The control plane wakes the shared builder and hands it a job; the builder
 * then streams logs and status back over the internal API. Dispatch failures
 * are retried by the queue (up to BUILD_MAX_ATTEMPTS) before the deployment is
 * marked failed, so a builder restart never loses a job silently.
 */
export async function processDeployJob(
  job: DeployJob,
  attempt: number,
): Promise<void> {
  const deployment = await findDeployment(job.deploymentId);
  if (!deployment) return;

  // Ignore jobs for deployments that already finished or were retried.
  if (deployment.status !== "queued" && deployment.status !== "preparing") {
    return;
  }

  const env = await getEnv();
  const registry = env.OCI_REGISTRY;
  if (!registry) {
    await markDeploymentFailed(
      deployment.id,
      "OCI_REGISTRY is not configured. Set it to the registry the builder pushes to.",
    );
    return;
  }

  // The image is pushed into the deployment app's own registry namespace, so
  // the app must exist before the build starts (Fly requires app-named repos).
  const appName = await ensureDeploymentFlyApp(deployment);

  const imageRef = buildImageRef({
    registry,
    appName,
    buildNumber: deployment.buildNumber,
  });

  try {
    await setDeploymentStatus(deployment.id, "preparing", { flyAppId: appName });
    await appendSystemLog(
      deployment.id,
      `Preparing build for ${deployment.repoOwner}/${deployment.repoName}@${deployment.branch}.`,
    );
    await ensureBuilderAwake();
    await dispatchBuild({
      deploymentId: deployment.id,
      repoUrl: deployment.repoUrl,
      branch: deployment.branch,
      imageRef,
      buildNumber: deployment.buildNumber,
      // Pass discovery-resolved fields so the builder uses the exact context
      ...(deployment.rootDirectory ? { rootDirectory: deployment.rootDirectory } : {}),
      ...(deployment.commitSha ? { commitSha: deployment.commitSha } : {}),
    });
    await appendSystemLog(deployment.id, "Build job handed to the builder.");
  } catch (error) {
    const message = errorMessage(error);
    const maxAttempts = buildMaxAttempts(env);
    if (attempt < maxAttempts) {
      await appendDeploymentLogs(deployment.id, [
        { stream: "stderr", message },
        {
          stream: "system",
          message: `Retrying build dispatch (attempt ${attempt + 1} of ${maxAttempts}).`,
        },
      ]);
      throw error;
    }
    await markDeploymentFailed(deployment.id, message);
  }
}