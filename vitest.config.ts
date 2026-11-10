import path from "node:path";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode || "development", process.cwd(), "");
  process.env = { ...process.env, ...env };

  return {
    test: {
      globals: true,
      environment: "node",
      include: ["tests/storage/**/*.test.ts"],
      env,
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./"),
      },
    },
  };
});
