import fetchHandler from "vinext/server/fetch-handler";
import type { AuthJob } from "../lib/queue";

const handler = typeof fetchHandler === "function" ? { fetch: fetchHandler } : fetchHandler;

async function processJob(job: AuthJob) {
  switch (job.type) {
    case "welcome-email":
      console.log(
        `[queue] welcome-email for ${job.email} (${job.userId})`,
      );
      break;
  }
}

export default {
  ...handler,
  queue: async (batch: MessageBatch<AuthJob>) => {
    for (const message of batch.messages) {
      await processJob(message.body);
    }
  },
};