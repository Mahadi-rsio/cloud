import { describe, expect, it } from "vitest";
import {
  calculateTrialEndDate,
  canPerformStorageOperation,
  canTransitionStatus,
  isTrialExpired,
} from "@/lib/storage/lifecycle";

describe("Tenant Lifecycle & Trial Rules", () => {
  it("calculates trial end date 7 days in the future", () => {
    const base = new Date("2026-11-10T00:00:00.000Z");
    const end = calculateTrialEndDate(7, base);
    expect(end).toBe("2026-11-17T00:00:00.000Z");
  });

  it("identifies expired vs active trials accurately", () => {
    const past = "2026-11-01T00:00:00.000Z";
    const future = "2026-11-20T00:00:00.000Z";
    const now = new Date("2026-11-10T00:00:00.000Z");

    expect(isTrialExpired(past, now)).toBe(true);
    expect(isTrialExpired(future, now)).toBe(false);
    expect(isTrialExpired(null, now)).toBe(false);
  });

  it("validates legal lifecycle state transitions", () => {
    // Valid transitions
    expect(canTransitionStatus("trial", "active")).toBe(true);
    expect(canTransitionStatus("trial", "suspended")).toBe(true);
    expect(canTransitionStatus("active", "suspended")).toBe(true);
    expect(canTransitionStatus("suspended", "active")).toBe(true);
    expect(canTransitionStatus("suspended", "deleted")).toBe(true);
    expect(canTransitionStatus("pending_delete", "deleted")).toBe(true);
    expect(canTransitionStatus("pending_delete", "active")).toBe(true);

    // Invalid transitions
    expect(canTransitionStatus("deleted", "active")).toBe(false);
    expect(canTransitionStatus("deleted", "trial")).toBe(false);
    expect(canTransitionStatus("active", "trial")).toBe(false);
  });

  it("governs storage operations based on status and trial expiration", () => {
    // Active tenant: all allowed
    expect(canPerformStorageOperation("active", null, "write").allowed).toBe(true);
    expect(canPerformStorageOperation("active", null, "read").allowed).toBe(true);

    // Suspended tenant: all blocked
    expect(canPerformStorageOperation("suspended", null, "read").allowed).toBe(false);
    expect(canPerformStorageOperation("suspended", null, "write").allowed).toBe(false);

    // Trial not expired: all allowed
    const future = new Date(Date.now() + 100000).toISOString();
    expect(canPerformStorageOperation("trial", future, "write").allowed).toBe(true);

    // Trial expired: read allowed (grace), write/delete blocked
    const past = new Date(Date.now() - 100000).toISOString();
    expect(canPerformStorageOperation("trial", past, "read").allowed).toBe(true);
    const writeCheck = canPerformStorageOperation("trial", past, "write");
    expect(writeCheck.allowed).toBe(false);
    if (!writeCheck.allowed) {
      expect(writeCheck.status).toBe(402);
    }
  });
});
