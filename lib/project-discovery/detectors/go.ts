import path from "node:path";
import { readFile } from "node:fs/promises";

export interface GoDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectGoFramework(
  dir: string,
  files: string[],
): Promise<GoDetection | null> {
  if (!files.includes("go.mod") && !files.some((f) => f.endsWith(".go"))) {
    return null;
  }

  let goModContent = "";
  if (files.includes("go.mod")) {
    try {
      goModContent = await readFile(path.join(dir, "go.mod"), "utf8");
    } catch {}
  }

  if (goModContent.includes("github.com/gin-gonic/gin")) {
    return {
      framework: "gin",
      frameworkName: "Gin",
      confidence: 0.95,
    };
  }

  if (goModContent.includes("github.com/labstack/echo")) {
    return {
      framework: "echo",
      frameworkName: "Echo",
      confidence: 0.95,
    };
  }

  if (goModContent.includes("github.com/gofiber/fiber")) {
    return {
      framework: "fiber",
      frameworkName: "Fiber",
      confidence: 0.95,
    };
  }

  if (goModContent.includes("github.com/go-chi/chi")) {
    return {
      framework: "chi",
      frameworkName: "Chi",
      confidence: 0.9,
    };
  }

  // Generic Go app
  if (files.includes("go.mod") || files.includes("main.go")) {
    return {
      framework: "go",
      frameworkName: "Go Web Application",
      confidence: 0.8,
    };
  }

  return null;
}
