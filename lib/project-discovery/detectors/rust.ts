import path from "node:path";
import { readFile } from "node:fs/promises";

export interface RustDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectRustFramework(
  dir: string,
  files: string[],
): Promise<RustDetection | null> {
  if (!files.includes("Cargo.toml")) {
    return null;
  }

  let cargoContent = "";
  try {
    cargoContent = await readFile(path.join(dir, "Cargo.toml"), "utf8");
  } catch {
    return null;
  }

  if (cargoContent.includes("axum")) {
    return {
      framework: "axum",
      frameworkName: "Axum",
      confidence: 0.95,
    };
  }

  if (cargoContent.includes("actix-web")) {
    return {
      framework: "actix-web",
      frameworkName: "Actix Web",
      confidence: 0.95,
    };
  }

  if (cargoContent.includes("rocket")) {
    return {
      framework: "rocket",
      frameworkName: "Rocket",
      confidence: 0.95,
    };
  }

  return {
    framework: "rust",
    frameworkName: "Rust Application",
    confidence: 0.8,
  };
}
