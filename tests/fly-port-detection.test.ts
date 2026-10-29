import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseListeningPorts, decidePort } from "@/lib/fly/port-detection";

// ---------------------------------------------------------------------------
// parseListeningPorts
// ---------------------------------------------------------------------------

describe("parseListeningPorts", () => {
  it("returns empty arrays for empty input", () => {
    assert.deepEqual(parseListeningPorts(""), { reachable: [], loopbackOnly: [] });
    assert.deepEqual(parseListeningPorts("\n\n"), { reachable: [], loopbackOnly: [] });
  });

  it("parses an IPv4 all-interfaces LISTEN entry", () => {
    // Port 8080 = 0x1F90, bound to 0.0.0.0 (all interfaces)
    const tcp = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0",
    ].join("\n");
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, [8080]);
    assert.deepEqual(result.loopbackOnly, []);
  });

  it("parses an IPv4 loopback-only LISTEN entry", () => {
    // Port 5432 = 0x1538, bound to 127.0.0.1 (loopback, little-endian = 0100007F)
    const tcp = [
      "  sl  local_address rem_address   st",
      "   0: 0100007F:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000",
    ].join("\n");
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, []);
    assert.deepEqual(result.loopbackOnly, [5432]);
  });

  it("parses an IPv6 all-interfaces LISTEN entry", () => {
    // Port 3000 = 0x0BB8, local_address = 00000000000000000000000000000000:0BB8
    const tcp6 = [
      "  sl  local_address                         remote_address                        st",
      "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000",
    ].join("\n");
    const result = parseListeningPorts(tcp6);
    assert.deepEqual(result.reachable, [3000]);
    assert.deepEqual(result.loopbackOnly, []);
  });

  it("ignores non-LISTEN state entries (state != 0A)", () => {
    // State 01 = ESTABLISHED, should be ignored
    const tcp = [
      "  sl  local_address rem_address   st",
      "   0: 00000000:1F90 00000000:0000 01 00000000:00000000 00:00000000 00000000     0        0 1",
    ].join("\n");
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, []);
    assert.deepEqual(result.loopbackOnly, []);
  });

  it("ignores header lines", () => {
    const tcp = "  sl  local_address rem_address   st tx_queue rx_queue";
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, []);
    assert.deepEqual(result.loopbackOnly, []);
  });

  it("de-duplicates ports that appear in both tcp and tcp6", () => {
    // Port 8080 appears in both /proc/net/tcp and /proc/net/tcp6
    const combined = [
      "  sl  local_address rem_address   st",
      "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 1",
      "  sl  local_address                         remote_address                        st",
      "   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 1",
    ].join("\n");
    const result = parseListeningPorts(combined);
    assert.deepEqual(result.reachable, [8080]);
  });

  it("returns ports sorted ascending", () => {
    const tcp = [
      "  sl  local_address rem_address   st",
      "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 1",
      "   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 2",
      "   2: 00000000:01BB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 3",
    ].join("\n");
    // 0x1F90=8080, 0x0050=80, 0x01BB=443
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, [80, 443, 8080]);
  });

  it("does not put a port in loopbackOnly if it is also in reachable (dual-stack)", () => {
    // App bound to 0.0.0.0:3000 (IPv4) AND 127.0.0.1:3000 (loopback)
    const tcp = [
      "  sl  local_address rem_address   st",
      "   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 1",
      "   1: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 2",
    ].join("\n");
    const result = parseListeningPorts(tcp);
    assert.deepEqual(result.reachable, [3000]);
    assert.deepEqual(result.loopbackOnly, []);
  });

  it("handles a realistic combined /proc/net/tcp + /proc/net/tcp6 output", () => {
    // Simulates: Node app on 0.0.0.0:3000 + postgres on 127.0.0.1:5432
    const combined = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 123",
      "   1: 0100007F:1538 00000000:0000 0A 00000000:00000000 00:00000000 00000000   105        0 456",
      "  sl  local_address                         remote_address                        st",
      "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 789",
    ].join("\n");
    const result = parseListeningPorts(combined);
    assert.deepEqual(result.reachable, [3000]);
    assert.deepEqual(result.loopbackOnly, [5432]);
  });
});

// ---------------------------------------------------------------------------
// decidePort
// ---------------------------------------------------------------------------

describe("decidePort", () => {
  it("returns ok when configured port is reachable", () => {
    const d = decidePort({ configured: 8080, reachable: [8080], loopbackOnly: [] });
    assert.deepEqual(d, { action: "ok", port: 8080 });
  });

  it("returns ok when configured port is among multiple reachable ports", () => {
    const d = decidePort({ configured: 443, reachable: [80, 443, 8080], loopbackOnly: [] });
    assert.deepEqual(d, { action: "ok", port: 443 });
  });

  it("returns update with lowest reachable port when configured port is absent", () => {
    const d = decidePort({ configured: 8080, reachable: [3000, 4000], loopbackOnly: [] });
    assert.deepEqual(d, { action: "update", port: 3000 });
  });

  it("returns update with the single reachable port when configured is absent", () => {
    const d = decidePort({ configured: 8080, reachable: [3000], loopbackOnly: [] });
    assert.deepEqual(d, { action: "update", port: 3000 });
  });

  it("returns fail-loopback when only loopback listeners exist", () => {
    const d = decidePort({ configured: 8080, reachable: [], loopbackOnly: [3000] });
    assert.deepEqual(d, { action: "fail-loopback", ports: [3000] });
  });

  it("returns fail-loopback listing all loopback ports", () => {
    const d = decidePort({ configured: 8080, reachable: [], loopbackOnly: [3000, 5432] });
    assert.deepEqual(d, { action: "fail-loopback", ports: [3000, 5432] });
  });

  it("returns fail-none when nothing is detected", () => {
    const d = decidePort({ configured: 8080, reachable: [], loopbackOnly: [] });
    assert.deepEqual(d, { action: "fail-none" });
  });
});
