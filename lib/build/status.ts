/**
 * Deployment status model.
 *
 * A deployment moves forward through a fixed pipeline:
 *
 *   queued → preparing → building → pushing → deploying → active
 *
 * Any in-flight state can end in `failed` or `cancelled`. A terminal
 * deployment can be retried, which puts it back at `queued` (the build number
 * is incremented by the retry endpoint).
 */

export const deploymentStatuses = [
  "queued",
  "preparing",
  "building",
  "pushing",
  "deploying",
  "active",
  "failed",
  "cancelled",
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];

const TERMINAL = new Set<DeploymentStatus>(["active", "failed", "cancelled"]);

const ALLOWED_TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  queued: ["preparing", "failed", "cancelled"],
  preparing: ["building", "failed", "cancelled"],
  building: ["pushing", "failed", "cancelled"],
  pushing: ["deploying", "failed", "cancelled"],
  deploying: ["active", "failed", "cancelled"],
  active: ["queued"],
  failed: ["queued"],
  cancelled: ["queued"],
};

export function isTerminalStatus(status: string): status is DeploymentStatus {
  return TERMINAL.has(status as DeploymentStatus);
}

export function isDeploymentStatus(status: string): status is DeploymentStatus {
  return (deploymentStatuses as readonly string[]).includes(status);
}

/** True when `to` is a valid next state for `from` (same-state is idempotent). */
export function canTransition(from: string, to: DeploymentStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from as DeploymentStatus];
  return allowed ? allowed.includes(to) : false;
}

/** Only finished deployments can be retried. */
export function canRetry(status: string): boolean {
  return isTerminalStatus(status);
}

/** Human-readable pipeline stage used in log lines and the UI. */
export function statusStageLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing build";
    case "building":
      return "Building image";
    case "pushing":
      return "Pushing image";
    case "deploying":
      return "Deploying";
    case "active":
      return "Live";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}