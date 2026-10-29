import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rewriteRailpackPlan } from "../builder/server.mjs";

const CUSTOM_BUILDER = "registry.fly.io/cloud-builder:railpack-builder-mise-2026.10.14";
const UPSTREAM_BUILDER = "ghcr.io/railwayapp/railpack-builder:mise-2026.10.14";

function syntheticPlan() {
  return {
    provider: "node",
    steps: [
      {
        name: "packages:apt:runtime",
        inputs: [{ image: "dunglas/frankenphp:latest" }],
        commands: [
          {
            cmd: "sh -c 'apt-get update && apt-get install -y libatomic1'",
            customName: "install apt packages: libatomic1",
          },
        ],
      },
      {
        name: "packages:mise",
        inputs: [{ image: UPSTREAM_BUILDER }],
        commands: [
          { path: "/mise/shims" },
          {
            cmd: "mise install",
            customName: "install mise packages: node",
          },
        ],
      },
      {
        name: "install",
        inputs: [{ step: "packages:mise" }],
        commands: [{ cmd: "npm install" }],
      },
      {
        name: "build",
        inputs: [{ step: "install" }],
        commands: [{ cmd: "npm run build" }],
      },
    ],
  };
}

describe("Builder rewriteRailpackPlan", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-test-"));
    planPath = path.join(tmpDir, "railpack-plan.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rewrites user steps with cacheKey and packages with custom builder image", async () => {
    const original = syntheticPlan();
    await fs.writeFile(planPath, JSON.stringify(original, null, 2));

    const result = await rewriteRailpackPlan(planPath, CUSTOM_BUILDER, "dep123");
    assert.ok(result);

    const rewritten = JSON.parse(await fs.readFile(planPath, "utf8"));

    // packages:apt:runtime: unchanged, no marker
    const apt = rewritten.steps.find((s: { name: string }) => s.name === "packages:apt:runtime");
    assert.equal(apt.inputs[0].image, "dunglas/frankenphp:latest");
    assert.equal(apt.commands.length, 1);
    assert.equal(apt.commands[0].customName, "install apt packages: libatomic1");

    // packages:mise: builder image repointed and prune appended, no marker
    const mise = rewritten.steps.find((s: { name: string }) => s.name === "packages:mise");
    assert.equal(mise.inputs[0].image, CUSTOM_BUILDER);
    assert.equal(mise.commands.length, 3);
    assert.deepEqual(
      mise.commands.map((c: { cmd?: string }) => c.cmd),
      [undefined, "mise install", "mise prune --yes"],
    );
    assert.equal(mise.commands[2].customName, "prune unused runtimes");
    assert.ok(!mise.commands.some((c: { customName?: string }) => c.customName?.includes("cloudisy-nocache")));

    // install and build: start with true # cloudisy-nocache:dep123
    const install = rewritten.steps.find((s: { name: string }) => s.name === "install");
    assert.equal(install.commands.length, 2);
    assert.deepEqual(install.commands[0], {
      cmd: "true # cloudisy-nocache:dep123",
      customName: "cloudisy-nocache:dep123",
    });
    assert.equal(install.commands[1].cmd, "npm install");

    const build = rewritten.steps.find((s: { name: string }) => s.name === "build");
    assert.equal(build.commands.length, 2);
    assert.deepEqual(build.commands[0], {
      cmd: "true # cloudisy-nocache:dep123",
      customName: "cloudisy-nocache:dep123",
    });
    assert.equal(build.commands[1].cmd, "npm run build");
  });

  it("is idempotent: running the rewrite twice produces identical output", async () => {
    const original = syntheticPlan();
    await fs.writeFile(planPath, JSON.stringify(original, null, 2));

    await rewriteRailpackPlan(planPath, CUSTOM_BUILDER, "dep123");
    const firstOutput = await fs.readFile(planPath, "utf8");

    const secondResult = await rewriteRailpackPlan(planPath, CUSTOM_BUILDER, "dep123");
    const secondOutput = await fs.readFile(planPath, "utf8");

    assert.equal(secondOutput, firstOutput);
    assert.equal(secondResult, null);
  });

  it("adds markers to user steps and leaves images untouched when builder image is upstream or unset", async () => {
    const original = syntheticPlan();
    await fs.writeFile(planPath, JSON.stringify(original, null, 2));

    // Test with upstream builder image
    const result = await rewriteRailpackPlan(planPath, UPSTREAM_BUILDER, "dep456");
    assert.ok(result);

    const rewritten = JSON.parse(await fs.readFile(planPath, "utf8"));

    // Images must be untouched
    const mise = rewritten.steps.find((s: { name: string }) => s.name === "packages:mise");
    assert.equal(mise.inputs[0].image, UPSTREAM_BUILDER);
    assert.ok(!mise.commands.some((c: { cmd?: string }) => c.cmd === "mise prune --yes"));

    // Markers must still be added to non-packages steps
    const install = rewritten.steps.find((s: { name: string }) => s.name === "install");
    assert.deepEqual(install.commands[0], {
      cmd: "true # cloudisy-nocache:dep456",
      customName: "cloudisy-nocache:dep456",
    });

    const build = rewritten.steps.find((s: { name: string }) => s.name === "build");
    assert.deepEqual(build.commands[0], {
      cmd: "true # cloudisy-nocache:dep456",
      customName: "cloudisy-nocache:dep456",
    });
  });

  it("adds markers when builderImage is empty or undefined", async () => {
    const original = syntheticPlan();
    await fs.writeFile(planPath, JSON.stringify(original, null, 2));

    const result = await rewriteRailpackPlan(planPath, "", "dep789");
    assert.ok(result);

    const rewritten = JSON.parse(await fs.readFile(planPath, "utf8"));
    const install = rewritten.steps.find((s: { name: string }) => s.name === "install");
    assert.deepEqual(install.commands[0], {
      cmd: "true # cloudisy-nocache:dep789",
      customName: "cloudisy-nocache:dep789",
    });
  });

  it("handles steps with undefined commands property", async () => {
    const plan = {
      steps: [
        { name: "packages:mise", inputs: [{ image: UPSTREAM_BUILDER }] },
        { name: "build", inputs: [] }, // commands undefined like Python build step
      ],
    };
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2));

    const result = await rewriteRailpackPlan(planPath, "", "depPython");
    assert.ok(result);

    const rewritten = JSON.parse(await fs.readFile(planPath, "utf8"));
    const build = rewritten.steps.find((s: { name: string }) => s.name === "build");
    assert.deepEqual(build.commands, [
      {
        cmd: "true # cloudisy-nocache:depPython",
        customName: "cloudisy-nocache:depPython",
      },
    ]);
  });
});
