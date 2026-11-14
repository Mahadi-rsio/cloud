import fetchHandler from "vinext/server/fetch-handler";
import { processDeployJob, type DeployJob } from "../lib/build/process-job";
import {
  hasActiveDeploymentHint,
  recoverStaleDeployments,
} from "../lib/build/recovery";
import { DeploymentStreamDO } from "../lib/build/deployment-stream-do";
import { TenantMeterDO } from "../lib/storage/quota-do";
import { withDbScope } from "../lib/db";

export { TenantMeterDO, DeploymentStreamDO };

const handler = typeof fetchHandler === "function" ? { fetch: fetchHandler } : fetchHandler;

async function processJob(job: DeployJob, attempt: number) {
  if (job.type === "deploy-build") {
    await processDeployJob(job, attempt);
  }
}

export default {
  ...handler,
  fetch: ((request: Request, env: unknown, ctx: unknown) =>
    withDbScope(() =>
      (handler.fetch as (r: Request, e: unknown, c: unknown) => Promise<Response>)(
        request,
        env,
        ctx,
      ),
    )) as typeof handler.fetch,
  queue: (batch: MessageBatch<DeployJob>) => withDbScope(() => runQueue(batch)),
  scheduled: () => withDbScope(() => runScheduled()),
};

async function runQueue(batch: MessageBatch<DeployJob>) {
    for (const message of batch.messages) {
      try {
        await processJob(message.body, message.attempts);
        message.ack();
      } catch (error) {
        console.error("[queue] job failed", message.body, error);
        message.retry();
      }
    }
}

async function runScheduled() {
    try {
      // Only hit Neon on 5-minute ticks if KV hint indicates an active deployment,
      // or once per hour (minutes 0..4) as a low-frequency reconciliation safety net.
      const isHourlyReconcileTick = new Date().getUTCMinutes() < 5;
      const activeHint = isHourlyReconcileTick ? true : await hasActiveDeploymentHint();
      if (!activeHint) {
        return;
      }

      const recovered = await recoverStaleDeployments();
      if (recovered > 0) {
        console.log(`[cron] marked ${recovered} stale deployment(s) as failed`);
      }
    } catch (error) {
      console.error("[cron] stale deployment recovery failed", error);
    }
}
