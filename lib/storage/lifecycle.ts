import type { TenantStatus } from "./schema";

export const ALLOWED_STATUS_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  trial: ["active", "suspended", "pending_delete"],
  active: ["suspended", "pending_delete"],
  suspended: ["active", "pending_delete", "deleted"],
  pending_delete: ["deleted", "active"],
  deleted: [],
};

export const DEFAULT_TRIAL_DAYS = 7;

/**
 * Calculates a future ISO timestamp for trial expiration.
 */
export function calculateTrialEndDate(days = DEFAULT_TRIAL_DAYS, from = new Date()): string {
  const trialEnd = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return trialEnd.toISOString();
}

/**
 * Checks whether a tenant's trial has expired based on ISO timestamp string.
 */
export function isTrialExpired(trialEndsAt?: string | null, now = new Date()): boolean {
  if (!trialEndsAt) return false;
  const expiry = new Date(trialEndsAt);
  if (isNaN(expiry.getTime())) return false;
  return now.getTime() > expiry.getTime();
}

/**
 * Validates if a state transition from `current` to `target` is legal.
 */
export function canTransitionStatus(current: TenantStatus, target: TenantStatus): boolean {
  if (current === target) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[current] ?? [];
  return allowed.includes(target);
}

export type StorageOperation = "read" | "write" | "delete" | "list";

export type OperationCheckResult =
  | { allowed: true }
  | { allowed: false; status: number; reason: string };

/**
 * Checks if a tenant can perform a storage operation given its current lifecycle status and trial expiration.
 */
export function canPerformStorageOperation(
  tenantStatus: TenantStatus,
  trialEndsAt?: string | null,
  operation: StorageOperation = "read",
): OperationCheckResult {
  switch (tenantStatus) {
    case "deleted":
      return { allowed: false, status: 404, reason: "Tenant account has been deleted." };

    case "suspended":
      return {
        allowed: false,
        status: 403,
        reason: "Tenant account is suspended. Contact support to restore access.",
      };

    case "pending_delete":
      return {
        allowed: false,
        status: 403,
        reason: "Tenant account is pending deletion.",
      };

    case "trial":
      if (isTrialExpired(trialEndsAt)) {
        if (operation === "write" || operation === "delete") {
          return {
            allowed: false,
            status: 402,
            reason: "Tenant 7-day trial has expired. Upgrade to an active plan to resume uploads and modifications.",
          };
        }
      }
      return { allowed: true };

    case "active":
      return { allowed: true };

    default:
      return { allowed: false, status: 403, reason: "Invalid tenant status." };
  }
}
