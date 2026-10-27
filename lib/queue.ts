export type AuthJob = {
  type: "welcome-email";
  userId: string;
  email: string;
  name: string;
};

export type { DeployJob } from "@/lib/build/process-job";
export { enqueueDeployJob } from "@/lib/build/process-job";

export async function enqueueAuthJob(job: AuthJob) {
  try {
    const { env } = await import("cloudflare:workers");
    await env.AUTH_JOBS.send(job);
  } catch {
    // No queue binding outside a Workers runtime (plain `next dev`).
  }
}