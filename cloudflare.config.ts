import { bindings, defineConfig, defineWorker, triggers } from "cf/config";
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
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      AUTH_KV: bindings.kv(),
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