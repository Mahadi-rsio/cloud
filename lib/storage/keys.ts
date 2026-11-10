const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a Crockford base32 string from bytes.
 */
function toBase32(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]!;
    bits += 8;

    while (bits >= 5) {
      output += CROCKFORD_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += CROCKFORD_BASE32[(value << (5 - bits)) & 31];
  }

  return output.toLowerCase();
}

/**
 * Generate a collision-resistant, time-ordered random identifier.
 * Format: `<prefix>_<timestamp_base32><random_base32>`
 */
export function generatePrefixedId(prefix: string, randomBytesCount = 10): string {
  const timestamp = Date.now();
  const timeBytes = new Uint8Array(6);
  let temp = timestamp;
  for (let i = 5; i >= 0; i--) {
    timeBytes[i] = temp & 0xff;
    temp = Math.floor(temp / 256);
  }

  const randomBytes = new Uint8Array(randomBytesCount);
  crypto.getRandomValues(randomBytes);

  const combined = new Uint8Array(timeBytes.length + randomBytes.length);
  combined.set(timeBytes, 0);
  combined.set(randomBytes, timeBytes.length);

  return `${prefix}_${toBase32(combined)}`;
}

export function generateTenantId(): string {
  return generatePrefixedId("t", 10);
}

export function generateProjectId(): string {
  return generatePrefixedId("p", 10);
}

export function generateApiKeyId(): string {
  return generatePrefixedId("key", 10);
}

export function generateUsageDailyId(): string {
  return generatePrefixedId("ud", 8);
}

export function generateUsageEventId(): string {
  return generatePrefixedId("ue", 8);
}

export function generateAuditLogId(): string {
  return generatePrefixedId("aud", 8);
}

/**
 * Strips any tenant prefix from an ID if present to ensure clean formatting.
 */
export function cleanTenantId(tenantId: string): string {
  return tenantId.startsWith("t_") ? tenantId.slice(2) : tenantId;
}

/**
 * Strips any project prefix from an ID if present.
 */
export function cleanProjectId(projectId: string): string {
  return projectId.startsWith("p_") ? projectId.slice(2) : projectId;
}

export type PathValidationResult =
  | { valid: true; normalized: string }
  | { valid: false; error: string };

/**
 * Validates and normalizes an object path to prevent path traversal,
 * hidden files attacks, control character injection, and invalid S3/R2 keys.
 */
export function validatePath(rawPath: string): PathValidationResult {
  if (typeof rawPath !== "string") {
    return { valid: false, error: "Path must be a string." };
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { valid: false, error: "Path cannot be empty." };
  }

  if (trimmed.length > 1024) {
    return { valid: false, error: "Path exceeds maximum length of 1024 characters." };
  }

  // Reject null bytes, carriage returns, newlines, and other control chars
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { valid: false, error: "Path contains illegal control characters." };
  }

  // Reject backslashes
  if (trimmed.includes("\\")) {
    return { valid: false, error: "Path cannot contain backslashes." };
  }

  // Reject leading slashes (path must be relative to project root)
  if (trimmed.startsWith("/")) {
    return { valid: false, error: "Path cannot start with a leading slash." };
  }

  // Check for URL-encoded traversal attempts like %2e%2e, %2f, %00
  const lower = trimmed.toLowerCase();
  if (
    lower.includes("%00") ||
    lower.includes("%2e%2e") ||
    lower.includes("%5c") ||
    lower.includes("%2f%2f")
  ) {
    return { valid: false, error: "Path contains illegal encoded sequences." };
  }

  // Split into segments and inspect each
  const segments = trimmed.split("/");
  const normalizedSegments: string[] = [];

  for (const seg of segments) {
    if (seg === "" || seg === ".") {
      // Empty segment (e.g. double slash "a//b") or current directory "."
      return { valid: false, error: "Path contains empty or current-dir segments." };
    }
    if (seg === ".." || seg.includes("%2e")) {
      return { valid: false, error: "Path traversal ('..') is strictly prohibited." };
    }
    normalizedSegments.push(seg);
  }

  const normalized = normalizedSegments.join("/");
  return { valid: true, normalized };
}

/**
 * Formats the tenancy key layout: `t_<tenantId>/<projectId>/<path>`
 */
export function formatObjectKey(
  tenantId: string,
  projectId: string,
  path: string,
): string {
  const tid = cleanTenantId(tenantId);
  const pid = cleanProjectId(projectId);
  const validated = validatePath(path);

  if (!validated.valid) {
    throw new Error(`Invalid object path: ${validated.error}`);
  }

  return `t_${tid}/${pid}/${validated.normalized}`;
}

/**
 * Parses an R2 object key into tenantId, projectId, and path.
 */
export function parseObjectKey(objectKey: string): {
  tenantId: string;
  projectId: string;
  path: string;
} | null {
  if (!objectKey || typeof objectKey !== "string") return null;

  const firstSlash = objectKey.indexOf("/");
  if (firstSlash === -1) return null;

  const tenantPrefix = objectKey.slice(0, firstSlash);
  if (!tenantPrefix.startsWith("t_")) return null;

  const remaining = objectKey.slice(firstSlash + 1);
  const secondSlash = remaining.indexOf("/");
  if (secondSlash === -1) return null;

  const projectId = remaining.slice(0, secondSlash);
  const path = remaining.slice(secondSlash + 1);

  if (!projectId || !path) return null;

  return {
    tenantId: tenantPrefix,
    projectId: projectId.startsWith("p_") ? projectId : `p_${projectId}`,
    path,
  };
}
