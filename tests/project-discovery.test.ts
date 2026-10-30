import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, rm, writeFile, symlink } from "node:fs/promises";
import {
  discoverProjects,
  normalizeRelativePath,
  validateSafePath,
} from "@/lib/project-discovery";
import { rootDirectorySchema, createDeploymentSchema } from "@/lib/validators/deployment";

async function createFixture(
  prefix: string,
  files: Record<string, string>,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = path.join(
    os.tmpdir(),
    `disc-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  await mkdir(dir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }

  const cleanup = async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  return { dir, cleanup };
}

describe("Automatic Project Discovery Engine", () => {
  it("1. Root-level Next.js application", async () => {
    const { dir, cleanup } = await createFixture("nextjs", {
      "package.json": JSON.stringify({
        name: "my-next-app",
        dependencies: { next: "^14.0.0", react: "^18.2.0" },
      }),
      "next.config.js": "module.exports = {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "next-repo",
        branch: "main",
        commitSha: "sha1",
      });
      assert.equal(res.monorepo, false);
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].rootDirectory, ".");
      assert.equal(res.candidates[0].framework, "nextjs");
      assert.equal(res.candidates[0].isDeployable, true);
      assert.equal(res.recommendedRootDirectory, ".");
    } finally {
      await cleanup();
    }
  });

  it("2. React + Vite application", async () => {
    const { dir, cleanup } = await createFixture("vite", {
      "package.json": JSON.stringify({
        name: "my-vite-app",
        dependencies: { react: "^18.2.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
      "vite.config.ts": "export default {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "vite-repo",
        branch: "main",
        commitSha: "sha2",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "vite");
      assert.equal(res.candidates[0].rootDirectory, ".");
    } finally {
      await cleanup();
    }
  });

  it("3. Astro application", async () => {
    const { dir, cleanup } = await createFixture("astro", {
      "package.json": JSON.stringify({
        name: "my-astro-site",
        dependencies: { astro: "^4.0.0" },
      }),
      "astro.config.mjs": "export default {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "astro-repo",
        branch: "main",
        commitSha: "sha3",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "astro");
    } finally {
      await cleanup();
    }
  });

  it("4. SvelteKit application", async () => {
    const { dir, cleanup } = await createFixture("svelte", {
      "package.json": JSON.stringify({
        name: "my-svelte-app",
        devDependencies: { "@sveltejs/kit": "^2.0.0" },
      }),
      "svelte.config.js": "export default {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "svelte-repo",
        branch: "main",
        commitSha: "sha4",
      });
      assert.equal(res.candidates.length, 1);
      assert.ok(res.candidates[0].framework?.startsWith("sveltekit"));
      assert.equal(res.candidates[0].frameworkName, "SvelteKit");
    } finally {
      await cleanup();
    }
  });

  it("5. Django application", async () => {
    const { dir, cleanup } = await createFixture("django", {
      "manage.py": "#!/usr/bin/env python\nimport os",
      "requirements.txt": "django==4.2.0\ngunicorn==20.1.0",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "django-repo",
        branch: "main",
        commitSha: "sha5",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "django");
      assert.equal(res.candidates[0].language, "python");
      assert.equal(res.candidates[0].runtime, "python");
    } finally {
      await cleanup();
    }
  });

  it("6. FastAPI application", async () => {
    const { dir, cleanup } = await createFixture("fastapi", {
      "main.py": "from fastapi import FastAPI\napp = FastAPI()",
      "requirements.txt": "fastapi==0.100.0\nuvicorn==0.22.0",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "fastapi-repo",
        branch: "main",
        commitSha: "sha6",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "fastapi");
      assert.equal(res.candidates[0].runtime, "python");
    } finally {
      await cleanup();
    }
  });

  it("7. Laravel application", async () => {
    const { dir, cleanup } = await createFixture("laravel", {
      artisan: "#!/usr/bin/env php\n<?php",
      "composer.json": JSON.stringify({
        require: { "laravel/framework": "^10.0" },
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "laravel-repo",
        branch: "main",
        commitSha: "sha7",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "laravel");
      assert.equal(res.candidates[0].language, "php");
    } finally {
      await cleanup();
    }
  });

  it("8. Go application", async () => {
    const { dir, cleanup } = await createFixture("go", {
      "go.mod": "module example.com/go-app\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1",
      "main.go": "package main\nimport \"github.com/gin-gonic/gin\"\nfunc main() {}",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "go-repo",
        branch: "main",
        commitSha: "sha8",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "gin");
      assert.equal(res.candidates[0].language, "go");
      assert.equal(res.candidates[0].runtime, "go");
    } finally {
      await cleanup();
    }
  });

  it("9. Rust application", async () => {
    const { dir, cleanup } = await createFixture("rust", {
      "Cargo.toml": '[package]\nname = "my-rust-app"\nversion = "0.1.0"\n\n[dependencies]\naxum = "0.7"',
      "src/main.rs": "fn main() {}",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "rust-repo",
        branch: "main",
        commitSha: "sha9",
      });
      assert.equal(res.candidates.length, 1);
      assert.equal(res.candidates[0].framework, "axum");
      assert.equal(res.candidates[0].language, "rust");
    } finally {
      await cleanup();
    }
  });

  it("10. pnpm monorepo with multiple applications", async () => {
    const { dir, cleanup } = await createFixture("pnpm-mono", {
      "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'packages/*'",
      "package.json": JSON.stringify({ name: "monorepo-root", private: true }),
      "apps/web/package.json": JSON.stringify({
        name: "@mono/web",
        dependencies: { next: "^14.0.0", react: "^18.2.0" },
      }),
      "apps/web/next.config.js": "module.exports = {};",
      "apps/api/package.json": JSON.stringify({
        name: "@mono/api",
        dependencies: { "@nestjs/core": "^10.0.0" },
      }),
      "apps/api/nest-cli.json": "{}",
      "packages/ui/package.json": JSON.stringify({
        name: "@mono/ui",
        private: true,
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "pnpm-mono-repo",
        branch: "main",
        commitSha: "sha10",
      });
      assert.equal(res.monorepo, true);
      const roots = res.candidates.map((c) => c.rootDirectory);
      assert.ok(roots.includes("apps/web"));
      assert.ok(roots.includes("apps/api"));
      // Shared package ui should be excluded from deployable apps
      const uiCandidate = res.candidates.find((c) => c.rootDirectory === "packages/ui");
      assert.equal(uiCandidate?.isDeployable ?? false, false);
    } finally {
      await cleanup();
    }
  });

  it("11. npm workspace monorepo", async () => {
    const { dir, cleanup } = await createFixture("npm-workspaces", {
      "package.json": JSON.stringify({
        name: "npm-monorepo",
        workspaces: ["packages/*"],
      }),
      "packages/frontend/package.json": JSON.stringify({
        name: "frontend",
        dependencies: { react: "^18.2.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
      "packages/frontend/vite.config.ts": "export default {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "npm-workspaces-repo",
        branch: "main",
        commitSha: "sha11",
      });
      assert.equal(res.monorepo, true);
      const frontend = res.candidates.find((c) => c.rootDirectory === "packages/frontend");
      assert.ok(frontend);
      assert.equal(frontend.framework, "vite");
    } finally {
      await cleanup();
    }
  });

  it("12. Turborepo monorepo", async () => {
    const { dir, cleanup } = await createFixture("turbo", {
      "turbo.json": "{}",
      "package.json": JSON.stringify({
        name: "turbo-repo",
        workspaces: ["apps/*"],
      }),
      "apps/dashboard/package.json": JSON.stringify({
        name: "dashboard",
        dependencies: { next: "^14.0.0" },
      }),
      "apps/dashboard/next.config.js": "module.exports = {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "turbo-repo",
        branch: "main",
        commitSha: "sha12",
      });
      assert.equal(res.monorepo, true);
      const cand = res.candidates.find((c) => c.rootDirectory === "apps/dashboard");
      assert.ok(cand);
      assert.equal(cand.framework, "nextjs");
    } finally {
      await cleanup();
    }
  });

  it("13. Nx monorepo", async () => {
    const { dir, cleanup } = await createFixture("nx", {
      "nx.json": "{}",
      "package.json": JSON.stringify({ name: "nx-workspace" }),
      "apps/api/package.json": JSON.stringify({
        dependencies: { express: "^4.18.0" },
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "nx-repo",
        branch: "main",
        commitSha: "sha13",
      });
      assert.equal(res.monorepo, true);
      const cand = res.candidates.find((c) => c.rootDirectory === "apps/api");
      assert.ok(cand);
      assert.equal(cand.framework, "express");
    } finally {
      await cleanup();
    }
  });

  it("14. Multiple independent applications", async () => {
    const { dir, cleanup } = await createFixture("multi", {
      "frontend/package.json": JSON.stringify({
        dependencies: { next: "^14.0.0" },
      }),
      "frontend/next.config.js": "module.exports = {};",
      "backend/go.mod": "module backend\ngo 1.22",
      "backend/main.go": "package main\nfunc main() {}",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "multi-repo",
        branch: "main",
        commitSha: "sha14",
      });
      assert.equal(res.candidates.filter((c) => c.isDeployable).length, 2);
      assert.equal(res.requiresUserSelection, true);
    } finally {
      await cleanup();
    }
  });

  it("15. Shared package exclusion", async () => {
    const { dir, cleanup } = await createFixture("shared-exclusion", {
      "packages/eslint-config/package.json": JSON.stringify({
        name: "eslint-config",
        version: "1.0.0",
      }),
      "packages/ui/package.json": JSON.stringify({
        name: "@repo/ui",
        version: "1.0.0",
      }),
      "apps/web/package.json": JSON.stringify({
        dependencies: { next: "^14.0.0" },
      }),
      "apps/web/next.config.js": "module.exports = {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "shared-repo",
        branch: "main",
        commitSha: "sha15",
      });
      const deployable = res.candidates.filter((c) => c.isDeployable);
      assert.equal(deployable.length, 1);
      assert.equal(deployable[0].rootDirectory, "apps/web");
    } finally {
      await cleanup();
    }
  });

  it("16. Nested Dockerfile detection", async () => {
    const { dir, cleanup } = await createFixture("nested-dockerfile", {
      "services/worker/Dockerfile": "FROM alpine\nCMD echo 'worker'",
      "services/worker/package.json": JSON.stringify({ name: "worker" }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "docker-repo",
        branch: "main",
        commitSha: "sha16",
      });
      const worker = res.candidates.find((c) => c.rootDirectory === "services/worker");
      assert.ok(worker);
      assert.equal(worker.dockerfilePath, "services/worker/Dockerfile");
      assert.equal(worker.isDeployable, true);
    } finally {
      await cleanup();
    }
  });

  it("17. Unknown framework handling", async () => {
    const { dir, cleanup } = await createFixture("unknown", {
      "package.json": JSON.stringify({
        name: "custom-script",
        scripts: { start: "node index.js" },
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "unknown-repo",
        branch: "main",
        commitSha: "sha17",
      });
      assert.equal(res.candidates[0].framework, null);
      assert.equal(res.candidates[0].runtime, "nodejs");
    } finally {
      await cleanup();
    }
  });

  it("18. Conflicting framework signatures (e.g. Next.js which also depends on React)", async () => {
    const { dir, cleanup } = await createFixture("conflict-prio", {
      "package.json": JSON.stringify({
        dependencies: { next: "14.2.0", react: "18.2.0" },
      }),
      "next.config.js": "module.exports = {};",
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "conflict-repo",
        branch: "main",
        commitSha: "sha18",
      });
      // Must be Next.js, not generic React
      assert.equal(res.candidates[0].framework, "nextjs");
    } finally {
      await cleanup();
    }
  });

  it("19. Invalid root directory validation", async () => {
    assert.throws(
      () => normalizeRelativePath("../escaping"),
      /Path traversal is not permitted/,
    );
  });

  it("20. Path traversal attempts", async () => {
    const { dir, cleanup } = await createFixture("traversal", {
      "app/package.json": "{}",
    });
    try {
      await assert.rejects(
        () => validateSafePath(dir, "../../etc/passwd"),
        /Path traversal is not allowed/,
      );
      await assert.rejects(
        () => validateSafePath(dir, "/etc/passwd"),
        /Absolute paths are not allowed/,
      );
    } finally {
      await cleanup();
    }
  });

  it("21. Ignored directories (node_modules, .git, etc.)", async () => {
    const { dir, cleanup } = await createFixture("ignored", {
      "node_modules/dep/package.json": JSON.stringify({ name: "dep" }),
      ".next/server/package.json": JSON.stringify({ name: "next-internal" }),
      "src/package.json": JSON.stringify({
        dependencies: { express: "^4.18.0" },
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "ignore-repo",
        branch: "main",
        commitSha: "sha21",
      });
      const paths = res.candidates.map((c) => c.rootDirectory);
      assert.ok(!paths.includes("node_modules/dep"));
      assert.ok(!paths.includes(".next/server"));
      assert.ok(paths.includes("src"));
    } finally {
      await cleanup();
    }
  });

  it("22. Oversized repository and scan limits", async () => {
    const { dir, cleanup } = await createFixture("scan-limits", {
      "deep/level1/level2/level3/level4/level5/level6/package.json": JSON.stringify({
        name: "too-deep",
      }),
      "package.json": JSON.stringify({
        dependencies: { next: "^14.0.0" },
      }),
    });
    try {
      const res = await discoverProjects({
        repoRoot: dir,
        repoName: "limits-repo",
        branch: "main",
        commitSha: "sha22",
        maxDepth: 4,
      });
      const paths = res.candidates.map((c) => c.rootDirectory);
      assert.ok(!paths.some((p) => p.includes("level6")));
      assert.ok(paths.includes("."));
    } finally {
      await cleanup();
    }
  });

  it("23. Existing deployment without discovery metadata schema validation", () => {
    // Deployments created before discovery have undefined/null rootDirectory, framework, etc.
    const minimal = createDeploymentSchema.parse({
      url: "https://github.com/octocat/Hello-World",
    });
    assert.equal(minimal.url, "https://github.com/octocat/Hello-World");
    assert.equal(minimal.rootDirectory, undefined);
    assert.equal(minimal.framework, undefined);

    const withDiscovery = createDeploymentSchema.parse({
      url: "https://github.com/octocat/Hello-World",
      branch: "main",
      rootDirectory: "apps/web",
      framework: "nextjs",
      commitSha: "a1b2c3d4e5f6",
    });
    assert.equal(withDiscovery.rootDirectory, "apps/web");
    assert.equal(withDiscovery.framework, "nextjs");

    // Invalid rootDirectory must be rejected
    assert.throws(
      () =>
        createDeploymentSchema.parse({
          url: "https://github.com/octocat/Hello-World",
          rootDirectory: "../etc/passwd",
        }),
      /rootDirectory must be a relative POSIX path/,
    );
  });
});
