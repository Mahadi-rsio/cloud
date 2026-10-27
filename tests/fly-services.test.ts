import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildServices,
  buildMachineConfig,
  mergeMachineConfig,
} from "@/lib/fly/client";

describe("Fly Machine Service Configuration", () => {
  it("generates correct ports configuration with HTTP (80) and HTTPS (443)", () => {
    const services = buildServices(80);

    assert.equal(services.length, 1);
    const service = services[0];
    assert.equal(service.protocol, "tcp");
    assert.equal(service.internal_port, 80);
    assert.equal(service.autostart, true);
    assert.equal(service.autostop, "stop");
    assert.equal(service.min_machines_running, 0);

    assert.equal(service.ports.length, 2);

    // Port 80 - Public HTTP with force_https redirect
    const httpPort = service.ports.find((p) => p.port === 80);
    assert.ok(httpPort, "Port 80 must be configured");
    assert.deepEqual(httpPort?.handlers, ["http"]);
    assert.equal(httpPort?.force_https, true);

    // Port 443 - Public HTTPS with TLS termination + HTTP proxying
    const httpsPort = service.ports.find((p) => p.port === 443);
    assert.ok(httpsPort, "Port 443 must be configured");
    assert.deepEqual(httpsPort?.handlers, ["tls", "http"]);
    assert.equal(httpsPort?.force_https, undefined);
  });

  it("preserves runtime-specific internal_port across services", () => {
    const customPort = 3000;
    const services = buildServices(customPort);

    assert.equal(services[0].internal_port, customPort);
    // Both port 80 (redirect) and port 443 (TLS termination) route to this internal port
    assert.equal(services[0].ports[0].port, 80);
    assert.equal(services[0].ports[1].port, 443);
  });

  it("buildMachineConfig includes corrected services with default port 80 when runtime is undefined", () => {
    const config = buildMachineConfig(undefined, "nginx:alpine");

    assert.equal(config.image, "nginx:alpine");
    assert.deepEqual(config.guest, {
      cpu_kind: "shared",
      cpus: 1,
      memory_mb: 256,
    });

    const services = config.services as Array<{
      protocol: string;
      internal_port: number;
      ports: Array<{ port: number; handlers: string[]; force_https?: boolean }>;
    }>;
    assert.ok(Array.isArray(services), "services array must be included in machine config");
    assert.equal(services[0].internal_port, 80);

    const ports = services[0].ports;
    assert.deepEqual(ports[0], { port: 80, handlers: ["http"], force_https: true });
    assert.deepEqual(ports[1], { port: 443, handlers: ["tls", "http"] });
  });

  it("buildMachineConfig preserves custom runtime settings and internalPort", () => {
    const runtime = {
      image: "node:20-alpine",
      guest: {
        cpu_kind: "performance" as const,
        cpus: 2,
        memory_mb: 2048,
      },
      env: {
        NODE_ENV: "production",
        PORT: "8080",
      },
      internalPort: 8080,
    };

    const config = buildMachineConfig(runtime, "nginx:alpine");

    assert.equal(config.image, "node:20-alpine");
    assert.deepEqual(config.guest, {
      cpu_kind: "performance",
      cpus: 2,
      memory_mb: 2048,
    });
    assert.deepEqual(config.env, {
      NODE_ENV: "production",
      PORT: "8080",
    });

    const services = config.services as Array<{
      protocol: string;
      internal_port: number;
      ports: Array<{ port: number; handlers: string[]; force_https?: boolean }>;
    }>;
    assert.equal(services[0].internal_port, 8080);
    assert.deepEqual(services[0].ports[1], {
      port: 443,
      handlers: ["tls", "http"],
    });
  });

  it("mergeMachineConfig updates services when internalPort is updated", () => {
    const currentConfig = buildMachineConfig({ internalPort: 80 }, "nginx:alpine");
    const updated = mergeMachineConfig(currentConfig, { internalPort: 5000 });

    const services = updated.services as Array<{
      internal_port: number;
      ports: Array<{ port: number; handlers: string[] }>;
    }>;
    assert.equal(services[0].internal_port, 5000);
    assert.deepEqual(services[0].ports[1], {
      port: 443,
      handlers: ["tls", "http"],
    });
  });

  it("verifies complete Machine creation payload structure sent to Machines API", () => {
    const appName = "acme-test-app";
    const region = "iad";
    const runtime = {
      image: "nginx:alpine",
      internalPort: 80,
    };

    const payload = {
      name: appName,
      region,
      config: buildMachineConfig(runtime, "nginx:alpine"),
    };

    assert.equal(payload.name, "acme-test-app");
    assert.equal(payload.region, "iad");
    assert.equal(payload.config.image, "nginx:alpine");

    const services = payload.config.services as Array<{
      protocol: string;
      internal_port: number;
      ports: Array<{ port: number; handlers: string[]; force_https?: boolean }>;
      autostart: boolean;
      autostop: string;
    }>;

    assert.equal(services[0].protocol, "tcp");
    assert.equal(services[0].internal_port, 80);
    assert.equal(services[0].autostart, true);
    assert.equal(services[0].autostop, "stop");

    // Must have port 80 with HTTP handler and force_https redirect
    const p80 = services[0].ports.find((p) => p.port === 80);
    assert.ok(p80);
    assert.deepEqual(p80?.handlers, ["http"]);
    assert.equal(p80?.force_https, true);

    // Must have port 443 with TLS and HTTP handlers for TLS termination
    const p443 = services[0].ports.find((p) => p.port === 443);
    assert.ok(p443);
    assert.deepEqual(p443?.handlers, ["tls", "http"]);
  });
});
