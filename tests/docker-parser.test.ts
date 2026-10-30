import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDockerInput } from "@/lib/docker";

describe("parseDockerInput", () => {
  it("returns null for empty input", () => {
    assert.equal(parseDockerInput(""), null);
    assert.equal(parseDockerInput("   "), null);
  });

  it("parses plain Docker Hub images", () => {
    const res = parseDockerInput("nginx:alpine");
    assert.notEqual(res, null);
    assert.equal(res?.cleanedImage, "nginx:alpine");
    assert.equal(res?.registry, "dockerhub");
    assert.equal(res?.registryLabel, "Docker Hub");
    assert.equal(res?.repository, "nginx");
    assert.equal(res?.tag, "alpine");
  });

  it("strips 'docker pull' prefix", () => {
    const res = parseDockerInput("docker pull ghcr.io/org/repo:v1.2.3");
    assert.notEqual(res, null);
    assert.equal(res?.cleanedImage, "ghcr.io/org/repo:v1.2.3");
    assert.equal(res?.registry, "ghcr");
    assert.equal(res?.registryLabel, "GitHub Container Registry (GHCR)");
    assert.equal(res?.repository, "ghcr.io/org/repo");
    assert.equal(res?.tag, "v1.2.3");
  });

  it("handles podman and crane pull commands with flags", () => {
    const res1 = parseDockerInput("podman pull --platform linux/amd64 quay.io/prometheus/node-exporter:latest");
    assert.notEqual(res1, null);
    assert.equal(res1?.cleanedImage, "quay.io/prometheus/node-exporter:latest");
    assert.equal(res1?.registry, "quay");

    const res2 = parseDockerInput("docker pull -q 123456789.dkr.ecr.us-east-1.amazonaws.com/my-service:prod");
    assert.notEqual(res2, null);
    assert.equal(res2?.cleanedImage, "123456789.dkr.ecr.us-east-1.amazonaws.com/my-service:prod");
    assert.equal(res2?.registry, "ecr");
  });

  it("detects Google GCR and GitLab registries", () => {
    const gcr = parseDockerInput("gcr.io/my-proj/app:v1");
    assert.equal(gcr?.registry, "gcr");

    const gitlab = parseDockerInput("registry.gitlab.com/group/project/image:latest");
    assert.equal(gitlab?.registry, "gitlab");
  });
});
