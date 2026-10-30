import path from "node:path";
import { readFile } from "node:fs/promises";

export interface PythonDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectPythonFramework(
  dir: string,
  files: string[],
): Promise<PythonDetection | null> {
  const hasManagePy = files.includes("manage.py");
  const hasRequirements = files.includes("requirements.txt");
  const hasPyproject = files.includes("pyproject.toml");
  const hasPipfile = files.includes("Pipfile");

  if (!hasManagePy && !hasRequirements && !hasPyproject && !hasPipfile && !files.some((f) => f.endsWith(".py"))) {
    return null;
  }

  // Check Django via manage.py
  if (hasManagePy) {
    return {
      framework: "django",
      frameworkName: "Django",
      confidence: 0.95,
    };
  }

  // Read requirements.txt or pyproject.toml
  let manifestText = "";
  if (hasRequirements) {
    try {
      manifestText += await readFile(path.join(dir, "requirements.txt"), "utf8");
    } catch {}
  }
  if (hasPyproject) {
    try {
      manifestText += await readFile(path.join(dir, "pyproject.toml"), "utf8");
    } catch {}
  }
  if (hasPipfile) {
    try {
      manifestText += await readFile(path.join(dir, "Pipfile"), "utf8");
    } catch {}
  }

  const lower = manifestText.toLowerCase();

  // Django
  if (lower.includes("django")) {
    const match = lower.match(/django(?:==|>=|~=)([0-9.]+)/);
    return {
      framework: "django",
      frameworkName: "Django",
      version: match ? match[1] : undefined,
      confidence: 0.9,
    };
  }

  // FastAPI
  if (lower.includes("fastapi")) {
    const match = lower.match(/fastapi(?:==|>=|~=)([0-9.]+)/);
    return {
      framework: "fastapi",
      frameworkName: "FastAPI",
      version: match ? match[1] : undefined,
      confidence: 0.9,
    };
  }

  // Flask
  if (lower.includes("flask")) {
    const match = lower.match(/flask(?:==|>=|~=)([0-9.]+)/);
    return {
      framework: "flask",
      frameworkName: "Flask",
      version: match ? match[1] : undefined,
      confidence: 0.9,
    };
  }

  return null;
}
