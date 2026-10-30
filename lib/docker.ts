export type DockerRegistry =
  | "dockerhub"
  | "ghcr"
  | "quay"
  | "ecr"
  | "gcr"
  | "gitlab"
  | "other";

export interface ParsedDockerImage {
  raw: string;
  cleanedImage: string;
  registry: DockerRegistry;
  registryLabel: string;
  repository: string;
  tag: string;
}

/**
 * Extracts a clean docker image reference from a user input,
 * which may be a raw image name (e.g. `ghcr.io/org/repo:v1`) or a pull command
 * (e.g. `docker pull ghcr.io/org/repo:v1`, `podman pull ...`, `nerdctl pull ...`).
 */
export function parseDockerInput(input: string): ParsedDockerImage | null {
  if (!input || typeof input !== "string") return null;

  let cleaned = input.trim();
  if (!cleaned) return null;

  // Strip leading pull commands: "docker pull", "podman pull", "nerdctl pull", "crane pull", etc.
  cleaned = cleaned.replace(/^(?:docker|podman|nerdctl|crane)\s+pull\s+/i, "");

  // Match flags with space-separated values or = values (e.g. --platform linux/amd64 or --platform=linux/amd64 or -q)
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  let imageRef = "";

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      // If it's a flag with value like --platform or -p, check if it consumes next token
      if (!token.includes("=") && ["--platform", "-p", "--arch", "--os"].includes(token.toLowerCase())) {
        i++; // skip flag value
      }
      continue;
    }
    imageRef = token;
    break;
  }

  if (!imageRef) return null;

  // Basic validation: image ref must have reasonable characters
  if (!/^[a-zA-Z0-9_.\-/:@]+$/.test(imageRef)) {
    return null;
  }

  // Detect registry
  let registry: DockerRegistry = "dockerhub";
  let registryLabel = "Docker Hub";

  const firstSlash = imageRef.indexOf("/");
  const domainPart = firstSlash !== -1 ? imageRef.slice(0, firstSlash) : "";

  if (domainPart.includes("ghcr.io")) {
    registry = "ghcr";
    registryLabel = "GitHub Container Registry (GHCR)";
  } else if (domainPart.includes("quay.io")) {
    registry = "quay";
    registryLabel = "Quay.io";
  } else if (domainPart.includes("amazonaws.com") || domainPart.includes("ecr.")) {
    registry = "ecr";
    registryLabel = "Amazon ECR";
  } else if (domainPart.includes("gcr.io") || domainPart.includes("pkg.dev")) {
    registry = "gcr";
    registryLabel = "Google Artifact / Container Registry";
  } else if (domainPart.includes("gitlab.com")) {
    registry = "gitlab";
    registryLabel = "GitLab Container Registry";
  } else if (domainPart.includes(".") || domainPart.includes(":")) {
    // Has domain or port (e.g. registry.mycorp.com/image or localhost:5000/image)
    if (domainPart.includes("docker.io")) {
      registry = "dockerhub";
      registryLabel = "Docker Hub";
    } else {
      registry = "other";
      registryLabel = domainPart;
    }
  } else {
    // Official image (e.g. `nginx:alpine`) or user image without registry (e.g. `library/redis`, `stefanprodan/podinfo`)
    registry = "dockerhub";
    registryLabel = "Docker Hub";
  }

  // Extract tag
  let repository = imageRef;
  let tag = "latest";

  const tagIndex = imageRef.lastIndexOf(":");
  const digestIndex = imageRef.lastIndexOf("@");

  if (digestIndex !== -1) {
    repository = imageRef.slice(0, digestIndex);
    tag = imageRef.slice(digestIndex + 1);
  } else if (tagIndex !== -1 && tagIndex > imageRef.lastIndexOf("/")) {
    repository = imageRef.slice(0, tagIndex);
    tag = imageRef.slice(tagIndex + 1);
  }

  return {
    raw: input,
    cleanedImage: imageRef,
    registry,
    registryLabel,
    repository,
    tag,
  };
}
