import { describe, expect, it } from "vitest";
import { createDeploymentSchema } from "@/lib/validators/deployment";
import { parseDockerInput } from "@/lib/docker";

describe("Apps Service & Create Flow Validation", () => {
  it("validates createDeploymentSchema with machine specs", () => {
    const input = {
      url: "https://github.com/facebook/react",
      name: "my-react-app",
      region: "sin",
      machine: {
        cpuKind: "shared" as const,
        cpus: 2,
        memoryMb: 256,
      },
      branch: "main",
      rootDirectory: ".",
    };

    const parsed = createDeploymentSchema.parse(input);
    expect(parsed.name).toBe("my-react-app");
    expect(parsed.region).toBe("sin");
    expect(parsed.machine?.cpuKind).toBe("shared");
    expect(parsed.machine?.cpus).toBe(2);
    expect(parsed.machine?.memoryMb).toBe(256);
  });

  it("identifies initial free tier parameters", () => {
    const isFree = (machineType: string, ram: number, cpu: number, volume: number) =>
      machineType === "shared" && ram === 256 && cpu === 2 && volume === 0;

    expect(isFree("shared", 256, 2, 0)).toBe(true);
    expect(isFree("performance", 256, 2, 0)).toBe(false);
    expect(isFree("shared", 512, 2, 0)).toBe(false);
    expect(isFree("shared", 256, 4, 0)).toBe(false);
    expect(isFree("shared", 256, 2, 5)).toBe(false);
  });

  it("parses docker images properly for Docker tab", () => {
    const nginx = parseDockerInput("nginx:alpine");
    expect(nginx).not.toBeNull();
    expect(nginx?.cleanedImage).toBe("nginx:alpine");
    expect(nginx?.registryLabel).toBe("Docker Hub");

    const ghcr = parseDockerInput("docker pull ghcr.io/owner/custom-app:v1.2");
    expect(ghcr).not.toBeNull();
    expect(ghcr?.cleanedImage).toBe("ghcr.io/owner/custom-app:v1.2");
    expect(ghcr?.registryLabel).toBe("GitHub Container Registry (GHCR)");
  });
});
