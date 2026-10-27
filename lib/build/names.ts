/**
 * Fly app name that owns a deployment's images and machine. Each deployment
 * gets its own app so its image lives in the app-scoped registry namespace
 * (`registry.fly.io/<app>:<tag>`), which is the only shape Fly's registry
 * accepts.
 */
export function deploymentAppName(deploymentId: string): string {
  return `dep-${deploymentId.replace(/-/g, "").slice(0, 20)}`;
}