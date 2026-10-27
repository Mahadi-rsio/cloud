import fetchHandler from "vinext/server/fetch-handler";
import type { AuthJob } from "../lib/queue";
import { processDeployJob, type DeployJob } from "../lib/build/process-job";
import { recoverStaleDeployments } from "../lib/build/recovery";

const handler = typeof fetchHandler === "function" ? { fetch: fetchHandler } : fetchHandler;

type QueueJob = AuthJob | DeployJob;

async function processJob(job: QueueJob, attempt: number) {
  switch (job.type) {
    case "welcome-email":
      console.log(
        `[queue] welcome-email for ${job.email} (${job.userId})`,
      );
      break;
    case "deploy-build":
      await processDeployJob(job, attempt);
      break;
  }
}

export default {
  ...handler,
  queue: async (batch: MessageBatch<QueueJob>) => {
    for (const message of batch.messages) {
      try {
        await processJob(message.body, message.attempts);
        message.ack();
      } catch (error) {
        console.error("[queue] job failed", message.body, error);
        message.retry();
      }
    }
  },
  scheduled: async () => {
    try {
      const recovered = await recoverStaleDeployments();
      if (recovered > 0) {
        console.log(`[cron] marked ${recovered} stale deployment(s) as failed`);
      }
    } catch (error) {
      console.error("[cron] stale deployment recovery failed", error);
    }
  },
};