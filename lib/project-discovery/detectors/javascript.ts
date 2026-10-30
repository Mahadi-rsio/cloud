import path from "node:path";
import { readFile } from "node:fs/promises";

export interface NodeFrameworkDetection {
  slug: string;
  name: string;
  version?: string;
  confidence: number;
}

export async function detectJavaScriptFramework(
  dir: string,
  files: string[],
): Promise<NodeFrameworkDetection | null> {
  if (!files.includes("package.json")) {
    return null;
  }

  let pkg: any;
  try {
    const raw = await readFile(path.join(dir, "package.json"), "utf8");
    pkg = JSON.parse(raw);
  } catch {
    return null;
  }

  const allDeps: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  // TanStack Start
  if (allDeps["@tanstack/react-start"] || allDeps["@tanstack/start"]) {
    return {
      slug: "tanstack-start",
      name: "TanStack Start",
      version: allDeps["@tanstack/react-start"] || allDeps["@tanstack/start"],
      confidence: 0.95,
    };
  }

  // NestJS
  if (allDeps["@nestjs/core"] || files.includes("nest-cli.json")) {
    return {
      slug: "nestjs",
      name: "NestJS",
      version: allDeps["@nestjs/core"],
      confidence: 0.95,
    };
  }

  // Hono
  if (allDeps["hono"]) {
    return {
      slug: "hono",
      name: "Hono",
      version: allDeps["hono"],
      confidence: 0.9,
    };
  }

  // Fastify
  if (allDeps["fastify"]) {
    return {
      slug: "fastify",
      name: "Fastify",
      version: allDeps["fastify"],
      confidence: 0.9,
    };
  }

  // Express
  if (allDeps["express"]) {
    return {
      slug: "express",
      name: "Express",
      version: allDeps["express"],
      confidence: 0.9,
    };
  }

  return null;
}
