/**
 * Port auto-detection for deployed Fly Machines.
 *
 * After a machine starts we read /proc/net/tcp (IPv4) and /proc/net/tcp6
 * (IPv6) to find which ports the app is actually listening on, then compare
 * against the configured internal_port.  The logic mirrors Render's
 * "magic port" detection: inject PORT, scan for open ports, fail loudly if
 * nothing is reachable.
 *
 * All pure functions in this file are unit-tested and have no side effects.
 */

export type ListeningPorts = {
  /** Ports listening on all interfaces (0.0.0.0 / ::). Proxy traffic works. */
  reachable: number[];
  /** Ports listening only on 127.0.0.1 / ::1. Proxy traffic fails. */
  loopbackOnly: number[];
};

// /proc/net/tcp[6] field indices (space-separated, after skipping the header)
//   0: sl
//   1: local_address   (HEXIP:HEXPORT for IPv4, HEX32IP:HEXPORT for IPv6)
//   3: st              (0A = TCP_LISTEN)
const STATE_LISTEN = "0A";

// IPv4: all-zeros local address = 00000000
const IPV4_ANY = "00000000";
// IPv4: loopback = 0100007F  (127.0.0.1 stored in little-endian hex)
const IPV4_LOOPBACK = "0100007F";

// IPv6: all-zeros = 32 zeros
const IPV6_ANY = "0".repeat(32);
// IPv6: loopback = ::1 = 00000000000000000000000001000000 (little-endian)
const IPV6_LOOPBACK = "00000000000000000000000001000000";

/**
 * Parse the combined output of `cat /proc/net/tcp /proc/net/tcp6`.
 *
 * Returns two de-duplicated, sorted-ascending port arrays:
 *  - `reachable`    — bound to all interfaces; Fly proxy can reach them.
 *  - `loopbackOnly` — bound only to 127.0.0.1 / ::1; proxy cannot reach.
 */
export function parseListeningPorts(text: string): ListeningPorts {
  const reachable = new Set<number>();
  const loopbackOnly = new Set<number>();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const fields = line.split(/\s+/);
    // Header lines start with "sl" or a non-numeric first token
    if (!fields[0] || !/^\d+:?$/.test(fields[0])) continue;

    // field[1] = local_address, field[3] = state
    const localAddr = fields[1];
    const state = fields[3];
    if (!localAddr || state !== STATE_LISTEN) continue;

    const colonIdx = localAddr.lastIndexOf(":");
    if (colonIdx === -1) continue;

    const hexIp = localAddr.slice(0, colonIdx).toUpperCase();
    const hexPort = localAddr.slice(colonIdx + 1).toUpperCase();
    const port = parseInt(hexPort, 16);
    if (!Number.isFinite(port) || port < 1 || port > 65535) continue;

    if (hexIp === IPV4_ANY || hexIp === IPV6_ANY) {
      reachable.add(port);
    } else if (hexIp === IPV4_LOOPBACK || hexIp === IPV6_LOOPBACK) {
      loopbackOnly.add(port);
    }
    // Other specific-IP bindings are ignored (neither reachable nor loopback).
  }

  // A port on loopbackOnly is only "loopback-only" if it isn't ALSO on all
  // interfaces (dual-stack apps might show both).
  for (const p of reachable) loopbackOnly.delete(p);

  return {
    reachable: [...reachable].sort((a, b) => a - b),
    loopbackOnly: [...loopbackOnly].sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------------------
// Decision logic (pure, testable)
// ---------------------------------------------------------------------------

export type PortDecision =
  | { action: "ok"; port: number }
  | { action: "update"; port: number }
  | { action: "fail-loopback"; ports: number[] }
  | { action: "fail-none" };

/**
 * Decide what to do given the configured port and the detected listeners.
 *
 * Rules (in order):
 *  1. configured port is in `reachable` → ok, do nothing.
 *  2. other reachable ports exist → update to lowest reachable port
 *     (the configured port was already checked in step 1 and not present).
 *  3. only loopback listeners → fail with a clear message.
 *  4. nothing detected at all → fail with timeout message.
 */
export function decidePort(input: {
  configured: number;
  reachable: number[];
  loopbackOnly: number[];
}): PortDecision {
  const { configured, reachable, loopbackOnly } = input;

  if (reachable.includes(configured)) {
    return { action: "ok", port: configured };
  }

  if (reachable.length > 0) {
    // Prefer lowest reachable port (most likely the real HTTP server).
    return { action: "update", port: reachable[0] };
  }

  if (loopbackOnly.length > 0) {
    return { action: "fail-loopback", ports: loopbackOnly };
  }

  return { action: "fail-none" };
}
