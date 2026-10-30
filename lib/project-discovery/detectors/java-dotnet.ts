import path from "node:path";
import { readFile } from "node:fs/promises";

export interface JavaDotnetDetection {
  framework: string;
  frameworkName: string;
  language: string;
  runtime: string;
  version?: string;
  confidence: number;
}

export async function detectJavaOrDotnet(
  dir: string,
  files: string[],
): Promise<JavaDotnetDetection | null> {
  // Check Java (pom.xml, build.gradle, build.gradle.kts)
  const isMaven = files.includes("pom.xml");
  const isGradle = files.includes("build.gradle") || files.includes("build.gradle.kts");

  if (isMaven || isGradle) {
    let manifest = "";
    try {
      if (isMaven) {
        manifest = await readFile(path.join(dir, "pom.xml"), "utf8");
      } else if (files.includes("build.gradle")) {
        manifest = await readFile(path.join(dir, "build.gradle"), "utf8");
      } else {
        manifest = await readFile(path.join(dir, "build.gradle.kts"), "utf8");
      }
    } catch {}

    const isSpringBoot =
      manifest.includes("spring-boot") || manifest.includes("org.springframework.boot");

    return {
      framework: isSpringBoot ? "spring-boot" : "java",
      frameworkName: isSpringBoot ? "Spring Boot" : "Java Application",
      language: "java",
      runtime: "java",
      confidence: isSpringBoot ? 0.95 : 0.8,
    };
  }

  // Check .NET (*.csproj, *.sln)
  const csproj = files.find((f) => f.endsWith(".csproj"));
  const sln = files.find((f) => f.endsWith(".sln"));

  if (csproj || sln) {
    let projContent = "";
    if (csproj) {
      try {
        projContent = await readFile(path.join(dir, csproj), "utf8");
      } catch {}
    }

    const isAspNetCore =
      projContent.includes("Microsoft.AspNetCore") ||
      projContent.includes('Sdk="Microsoft.NET.Sdk.Web"');

    return {
      framework: isAspNetCore ? "aspnet-core" : "dotnet",
      frameworkName: isAspNetCore ? "ASP.NET Core" : ".NET Application",
      language: "csharp",
      runtime: "dotnet",
      confidence: isAspNetCore ? 0.95 : 0.8,
    };
  }

  return null;
}
