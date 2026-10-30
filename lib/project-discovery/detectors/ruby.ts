import path from "node:path";
import { readFile } from "node:fs/promises";

export interface RubyDetection {
  framework: string;
  frameworkName: string;
  version?: string;
  confidence: number;
}

export async function detectRubyFramework(
  dir: string,
  files: string[],
): Promise<RubyDetection | null> {
  const hasGemfile = files.includes("Gemfile");
  const hasConfigRu = files.includes("config.ru");

  if (!hasGemfile && !hasConfigRu && !files.some((f) => f.endsWith(".rb"))) {
    return null;
  }

  let gemfileText = "";
  if (hasGemfile) {
    try {
      gemfileText = await readFile(path.join(dir, "Gemfile"), "utf8");
    } catch {}
  }

  if (gemfileText.includes("gem 'rails'") || gemfileText.includes('gem "rails"')) {
    return {
      framework: "rails",
      frameworkName: "Ruby on Rails",
      confidence: 0.95,
    };
  }

  if (gemfileText.includes("gem 'sinatra'") || gemfileText.includes('gem "sinatra"')) {
    return {
      framework: "sinatra",
      frameworkName: "Sinatra",
      confidence: 0.9,
    };
  }

  if (hasGemfile || hasConfigRu) {
    return {
      framework: "ruby",
      frameworkName: "Ruby Application",
      confidence: 0.75,
    };
  }

  return null;
}
