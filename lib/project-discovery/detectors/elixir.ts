import path from "node:path";
import { readFile } from "node:fs/promises";

export interface ElixirDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectElixirFramework(
  dir: string,
  files: string[],
): Promise<ElixirDetection | null> {
  if (!files.includes("mix.exs")) {
    return null;
  }

  let mixText = "";
  try {
    mixText = await readFile(path.join(dir, "mix.exs"), "utf8");
  } catch {
    return null;
  }

  if (mixText.includes(":phoenix")) {
    return {
      framework: "phoenix",
      frameworkName: "Phoenix",
      confidence: 0.95,
    };
  }

  return {
    framework: "elixir",
    frameworkName: "Elixir Mix Application",
    confidence: 0.8,
  };
}
