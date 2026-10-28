import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseGitHubUrl,
  cloneUrl,
  checkGitHubRepository,
} from "@/lib/build/github";
import {
  findDockerfile,
  detectBuildStrategy,
} from "@/lib/build/strategy";
import {
  RAILPACK_FRONTEND_IMAGE,
  railpackPrepareArgs,
  dockerBuildxArgs,
  classifyPrepareExit,
  parseRailpackInfo,
} from "@/lib/build/railpack";
import {
  canTransition,
  canRetry,
  isTerminalStatus,
  isDeploymentStatus,
  statusStageLabel,
} from "@/lib/build/status";
import {
  parseLogCursor,
  formatSseEvent,
  splitLogChunk,
  normalizeLogMessage,
} from "@/lib/build/logs";
import { buildImageRef } from "@/lib/build/builder-client";
import { deploymentAppName } from "@/lib/build/names";

describe("GitHub URL parsing", () => {
  it("parses canonical public repository URLs", () => {
    const parsed = parseGitHubUrl("https://github.com/octocat/Hello-World");
    assert.ok(parsed);
    assert.equal(parsed.owner, "octocat");
    assert.equal(parsed.repo, "Hello-World");
  });

  it("normalizes a trailing slash", () => {
    const parsed = parseGitHubUrl("https://github.com/octocat/Hello-World/");
    assert.ok(parsed);
    assert.equal(parsed.repo, "Hello-World");
  });

  it("rejects git@ / ssh / non-GitHub hosts / fragments", () => {
    assert.equal(parseGitHubUrl("git@github.com:octocat/Hello-World.git"), null);
    assert.equal(parseGitHubUrl("https://gitlab.com/octocat/Hello-World"), null);
    assert.equal(parseGitHubUrl("https://github.com/octocat/Hello-World.git#main"), null);
  });

  it("rejects profile-only or shallow URLs", () => {
    assert.equal(parseGitHubUrl("https://github.com/octocat"), null);
    assert.equal(parseGitHubUrl("https://github.com/octocat/Hello-World/tree/main"), null);
  });

  it("builds a safe clone URL", () => {
    assert.equal(
      cloneUrl({ owner: "octocat", repo: "Hello-World", url: "https://github.com/octocat/Hello-World" }),
      "https://github.com/octocat/Hello-World.git",
    );
  });
});

describe("GitHub repository checks", () => {
  it("retries anonymously when a stale token is rejected with 401", async () => {
    const originalFetch = globalThis.fetch;
    const authorizations: Array<string | null> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      authorizations.push(authorization);
      if (authorization) {
        return new Response("unauthorized", { status: 401 });
      }
      return Response.json({
        private: false,
        fork: false,
        default_branch: "main",
        pushed_at: null,
      });
    }) as typeof fetch;

    try {
      const repository = parseGitHubUrl(
        "https://github.com/MrSaikatS/nextjs-starter-frontend",
      );
      assert.ok(repository);
      const status = await checkGitHubRepository(repository, "stale-token");
      assert.equal(status.ok, true);
      if (status.ok) assert.equal(status.defaultBranch, "main");
      assert.deepEqual(authorizations, ["Bearer stale-token", null]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Build strategy detection", () => {
  it("finds Dockerfile case-insensitively", () => {
    assert.equal(findDockerfile(["railpack.toml", "DOCKERFILE"]), "DOCKERFILE");
    assert.equal(findDockerfile(["Railpack.toml", "dockerfile"]), "dockerfile");
    assert.equal(findDockerfile(["Containerfile"]), "Containerfile");
  });

  it("does not treat arbitrary files as a Dockerfile", () => {
    assert.equal(findDockerfile(["Dockerfile.example", "dockerfile.txt", "Dockerfile.mine"]), null);
  });

  it("detects railpack when no Dockerfile is present", () => {
    const strategy = detectBuildStrategy(["package.json", "README.md"]);
    assert.equal(strategy.strategy, "railpack");
    assert.equal(strategy.dockerfile, null);
  });

  it("detects dockerfile strategy when a Dockerfile exists", () => {
    const strategy = detectBuildStrategy(["README.md", "Dockerfile"]);
    assert.equal(strategy.strategy, "dockerfile");
    assert.equal(strategy.dockerfile, "Dockerfile");
  });
});

describe("Railpack command construction", () => {
  it("prepares railpack prepare arguments", () => {
    const args = railpackPrepareArgs({
      directory: "/workspace/app",
      planOut: "railpack-plan.json",
      infoOut: "railpack-info.json",
    });
    assert.deepEqual(args, [
      "prepare",
      "/workspace/app",
      "--plan-out",
      "railpack-plan.json",
      "--info-out",
      "railpack-info.json",
    ]);
  });

  it("uses the railpack frontend image for plan builds", () => {
    const args = dockerBuildxArgs({
      contextDirectory: "/workspace/app",
      imageRef: "registry.example/deployments/abc:b1",
      planPath: "railpack-plan.json",
    });
    assert.ok(args.includes(`--build-arg`));
    assert.ok(args.includes(`BUILDKIT_SYNTAX=${RAILPACK_FRONTEND_IMAGE}`));
    assert.ok(args.includes("-f"));
    const index = args.indexOf("-f");
    assert.equal(args[index + 1], "railpack-plan.json");
    assert.ok(args.includes("--push"));
    assert.equal(args[args.length - 1], "/workspace/app");
  });

  it("builds a plain Dockerfile without the railpack frontend", () => {
    const args = dockerBuildxArgs({
      contextDirectory: "/workspace/app",
      imageRef: "registry.example/deployments/abc:b1",
      dockerfile: "Dockerfile",
    });
    assert.ok(!args.some((arg) => arg.includes("railpack-frontend")));
    assert.ok(args.includes("-f"));
    assert.ok(args.includes("Dockerfile"));
  });
});

describe("Railpack exit code classification", () => {
  it("treats 0 as success", () => {
    assert.equal(classifyPrepareExit(0), "success");
  });

  it("treats 75 and missing as retry", () => {
    assert.equal(classifyPrepareExit(75), "retry");
    assert.equal(classifyPrepareExit(null), "retry");
    assert.equal(classifyPrepareExit(undefined), "retry");
  });

  it("treats anything else as failure", () => {
    assert.equal(classifyPrepareExit(1), "fail");
    assert.equal(classifyPrepareExit(2), "fail");
  });
});

describe("Railpack info parsing", () => {
  it("extracts the internal port and start command from info", () => {
    const info = parseRailpackInfo({
      success: true,
      startCommand: "npm start",
      provider: "npm",
      internalPort: 8080,
      logs: ["detected provider npm"],
    });
    assert.equal(info.internalPort, 8080);
    assert.equal(info.startCommand, "npm start");
    assert.equal(info.provider, "npm");
    assert.equal(info.logs.length, 1);
  });

  it("reports failure with logs from the info file", () => {
    const info = parseRailpackInfo({ success: false, logs: [{ message: "no provider found" }] });
    assert.equal(info.success, false);
    assert.equal(info.logs[0], "no provider found");
  });
});

describe("Deployment status transitions", () => {
  it("recognizes deployment statuses", () => {
    assert.equal(isDeploymentStatus("queued"), true);
    assert.equal(isDeploymentStatus("active"), true);
    assert.equal(isDeploymentStatus("running"), false);
  });

  it("allows valid forward transitions", () => {
    assert.equal(canTransition("queued", "preparing"), true);
    assert.equal(canTransition("preparing", "building"), true);
    assert.equal(canTransition("building", "pushing"), true);
    assert.equal(canTransition("pushing", "deploying"), true);
    assert.equal(canTransition("deploying", "active"), true);
  });

  it("allows any non-terminal to fail or cancel", () => {
    assert.equal(canTransition("building", "failed"), true);
    assert.equal(canTransition("queued", "cancelled"), true);
  });

  it("only terminal states can move back to queued (retry)", () => {
    assert.equal(canTransition("failed", "queued"), true);
    assert.equal(canTransition("active", "queued"), true);
    assert.equal(canTransition("building", "queued"), false);
  });

  it("rejects invalid moves and allows idempotent same-state updates", () => {
    assert.equal(canTransition("active", "preparing"), false);
    assert.equal(canTransition("active", "failed"), false);
    assert.equal(canTransition("failed", "failed"), true);
  });

  it("only terminal statuses can be retried", () => {
    assert.equal(canRetry("active"), true);
    assert.equal(canRetry("failed"), true);
    assert.equal(canRetry("cancelled"), true);
    assert.equal(canRetry("building"), false);
  });

  it("labels stages", () => {
    assert.equal(statusStageLabel("preparing"), "Preparing build");
    assert.equal(statusStageLabel("failed"), "Failed");
  });

  it("treats active/failed/cancelled as terminal", () => {
    assert.equal(isTerminalStatus("active"), true);
    assert.equal(isTerminalStatus("failed"), true);
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("queued"), false);
  });
});

describe("Image reference & Fly app naming", () => {
  it("derives a stable app name from the deployment id", () => {
    const id = "9d6c3f3e-2a1b-4c5d-8e9f-0a1b2c3d4e5f";
    assert.equal(
      deploymentAppName(id),
      "dep-9d6c3f3e2a1b4c5d8e9f",
    );
    assert.match(deploymentAppName(id), /^dep-[a-z0-9]{20}$/);
  });

  it("builds an app-namespaced image ref for Fly", () => {
    const ref = buildImageRef({
      registry: "registry.fly.io",
      appName: "dep-9d6c3f3e2a1b4c5d8e9f",
      buildNumber: 1,
    });
    assert.equal(
      ref,
      "registry.fly.io/dep-9d6c3f3e2a1b4c5d8e9f:b1",
    );
  });

  it("builds an image ref under a custom registry root", () => {
    const ref = buildImageRef({
      registry: "ghcr.io/acme/",
      appName: "dep-abc",
      buildNumber: 4,
    });
    assert.equal(ref, "ghcr.io/acme/dep-abc:b4");
  });
});

describe("Deployment log helpers", () => {
  it("parses and formats log cursors", () => {
    assert.equal(parseLogCursor("123"), 123);
    assert.equal(parseLogCursor("0"), 0);
    assert.equal(parseLogCursor("abc"), null);
    assert.equal(parseLogCursor("-1"), null);
  });

  it("serializes SSE log events with stable ids", () => {
    const event = formatSseEvent({
      event: "log",
      id: 42,
      data: { stream: "stdout", message: "hello", timestamp: "t" },
    });
    assert.ok(event.startsWith("id: 42"));
    assert.ok(event.includes("event: log"));
    assert.ok(event.includes('"stream":"stdout"'));
    assert.ok(event.endsWith("\n\n"));
  });

  it("splits large log chunks into lines, keeping partial lines", () => {
    assert.deepEqual(splitLogChunk("line1\nline2\nline3"), {
      lines: ["line1", "line2"],
      remainder: "line3",
    });
    assert.deepEqual(splitLogChunk("line1\nline2\n"), {
      lines: ["line1", "line2"],
      remainder: "",
    });
  });

  it("normalizes log messages", () => {
    assert.equal(normalizeLogMessage("  padded  "), "  padded  ");
    assert.equal(normalizeLogMessage(""), "(empty line)");
    assert.equal(normalizeLogMessage("a\u0000b"), "ab");
  });
});