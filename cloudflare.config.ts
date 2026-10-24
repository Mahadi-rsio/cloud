import { bindings, defineConfig, defineWorker, triggers } from "cf/config";
import { createWorkersCacheConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersCacheConfig();

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "cloud",
    entrypoint: "./entrypoints/worker.ts",
    compatibilityDate: "2026-10-24",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      AUTH_KV: bindings.kv(),
      AUTH_JOBS: bindings.queue({ name: "auth-jobs" }),
      DATABASE_URL: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      BETTER_AUTH_URL: bindings.secret(),
    },
    triggers: [triggers.queue({ name: "auth-jobs" })],
  }),
});