import path from "node:path";
import { readFile } from "node:fs/promises";

export interface PhpDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectPhpFramework(
  dir: string,
  files: string[],
): Promise<PhpDetection | null> {
  const hasArtisan = files.includes("artisan");
  const hasComposer = files.includes("composer.json");

  if (!hasArtisan && !hasComposer && !files.some((f) => f.endsWith(".php"))) {
    return null;
  }

  if (hasArtisan) {
    return {
      framework: "laravel",
      frameworkName: "Laravel",
      confidence: 0.95,
    };
  }

  let composerText = "";
  if (hasComposer) {
    try {
      composerText = await readFile(path.join(dir, "composer.json"), "utf8");
    } catch {}
  }

  if (composerText.includes("laravel/framework")) {
    return {
      framework: "laravel",
      frameworkName: "Laravel",
      confidence: 0.95,
    };
  }

  if (composerText.includes("symfony/framework-bundle") || composerText.includes("symfony/symfony")) {
    return {
      framework: "symfony",
      frameworkName: "Symfony",
      confidence: 0.95,
    };
  }

  if (hasComposer || files.includes("index.php")) {
    return {
      framework: "php",
      frameworkName: "PHP Application",
      confidence: 0.75,
    };
  }

  return null;
}
