import { bindings, defineConfig, defineWorker, exports, triggers } from "cf/config";
import { createWorkersCacheConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersCacheConfig();

const isPreviewBuild = process.env.CLOUDFLARE_PREVIEW_BUILD === "true";

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
    exports: {
      ...cache.exports,
      TenantMeterDO: exports.durableObject({ storage: "sqlite" }),
      DeploymentStreamDO: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      ...cache.env,
      APP_KV: bindings.kv({ id: "e47009bf45b743bcb99d2f5d7996827f" }),
      ...(process.env.CLOUDFLARE_HYPERDRIVE_ID
        ? {
            HYPERDRIVE: bindings.hyperdrive({
              id: process.env.CLOUDFLARE_HYPERDRIVE_ID,
              dev: {
                connectionString: process.env.DATABASE_URL,
              },
            }),
          }
        : {}),
      RL_API_FREE: bindings.rateLimit({
        namespace: "1001",
        simple: { limit: 120, period: 60 },
      }),
      RL_API_PRO: bindings.rateLimit({
        namespace: "1002",
        simple: { limit: 600, period: 60 },
      }),
      RL_STUDIO: bindings.rateLimit({
        namespace: "1003",
        simple: { limit: 180, period: 60 },
      }),
      RL_STORAGE_READ: bindings.rateLimit({
        namespace: "1004",
        simple: { limit: 1000, period: 60 },
      }),
      RL_STORAGE_WRITE: bindings.rateLimit({
        namespace: "1005",
        simple: { limit: 300, period: 60 },
      }),
      RL_STORAGE_ADMIN: bindings.rateLimit({
        namespace: "1006",
        simple: { limit: 60, period: 60 },
      }),
      RL_STORAGE_PRO_READ: bindings.rateLimit({
        namespace: "1007",
        simple: { limit: 5000, period: 60 },
      }),
      RL_STORAGE_PRO_WRITE: bindings.rateLimit({
        namespace: "1008",
        simple: { limit: 1500, period: 60 },
      }),
      STORAGE_METER: bindings.durableObject({
        worker: "cloud",
        exportName: "TenantMeterDO",
      }),
      DEPLOYMENT_STREAM: bindings.durableObject({
        worker: "cloud",
        exportName: "DeploymentStreamDO",
      }),
      ASSETS: bindings.assets(),
      AUTH_JOBS: bindings.queue({ name: "auth-jobs" }),
      BUILD_JOBS: bindings.queue({ name: "build-jobs" }),
      DATABASE_URL: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      BETTER_AUTH_URL: bindings.secret(),
      FLY_API_TOKEN: bindings.secret(),
      FLY_ORG_SLUG: bindings.secret(),
      FLY_DEFAULT_REGION: bindings.secret(),
      FLY_DEFAULT_IMAGE: bindings.secret(),
      BUILDER_URL: bindings.secret(),
      BUILDER_API_TOKEN: bindings.secret(),
      BUILDER_APP_NAME: bindings.secret(),
      BUILDER_MACHINE_ID: bindings.secret(),
      INTERNAL_API_TOKEN: bindings.secret(),
      CONTROL_PLANE_URL: bindings.secret(),
      OCI_REGISTRY: bindings.secret(),
      OCI_REGISTRY_USERNAME: bindings.secret(),
      OCI_REGISTRY_PASSWORD: bindings.secret(),
      BUILD_IDLE_TIMEOUT_MS: bindings.secret(),
      BUILD_MAX_ATTEMPTS: bindings.secret(),
      BUILD_WORKSPACE_DIR: bindings.secret(),
      BUILD_DEFAULT_INTERNAL_PORT: bindings.secret(),
      GITHUB_API_TOKEN: bindings.secret(),
      STORAGE_BUCKET: bindings.r2({ name: "cloud-storage" }),
    },
    ...(isPreviewBuild
      ? {}
      : {
          triggers: [
            triggers.queue({ name: "auth-jobs" }),
            triggers.queue({ name: "build-jobs" }),
            triggers.scheduled({ schedule: "*/5 * * * *" }),
          ],
        }),
  }),
});