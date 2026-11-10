/**
 * Hash an API key or secret with SHA-256 using standard Web Crypto.
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type ApiKeyEnvironment = "live" | "test";

export interface GeneratedApiKey {
  /** The full plaintext key to display to the user once upon creation */
  key: string;
  /** Safe prefix to store and display in UI (e.g., sk_live_a1b2c3d4) */
  prefix: string;
  /** SHA-256 hash to persist in database */
  keyHash: string;
}

/**
 * Generates a cryptographically secure, prefixed API key.
 */
export async function generateApiKey(
  env: ApiKeyEnvironment = "live",
): Promise<GeneratedApiKey> {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const entropyHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const key = `sk_${env}_${entropyHex}`;
  const prefix = `sk_${env}_${entropyHex.slice(0, 8)}`;
  const keyHash = await hashApiKey(key);

  return { key, prefix, keyHash };
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify plaintext API key against stored SHA-256 hash.
 */
export async function verifyApiKeyHash(
  plaintextKey: string,
  storedHash: string,
): Promise<boolean> {
  const calculatedHash = await hashApiKey(plaintextKey);
  return timingSafeEqual(calculatedHash, storedHash);
}

export type StorageScope =
  | "storage:read"
  | "storage:write"
  | "storage:delete"
  | "storage:admin"
  | "*";

export function parseScopes(scopes: string | string[]): Set<string> {
  if (Array.isArray(scopes)) {
    return new Set(scopes.map((s) => s.trim()).filter(Boolean));
  }
  return new Set(
    scopes
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Check if the given scopes satisfy the required scope.
 */
export function hasScope(
  grantedScopes: string | string[],
  requiredScope: StorageScope | string,
): boolean {
  const set = parseScopes(grantedScopes);
  if (set.has("*")) return true;
  if (set.has(requiredScope)) return true;
  if (requiredScope === "storage:read" && set.has("storage:write")) return true;
  return false;
}

/**
 * Extracts Bearer token from Authorization header or `x-api-key`.
 */
export function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [type, token] = authHeader.split(" ");
    if (type?.toLowerCase() === "bearer" && token) {
      return token.trim();
    }
  }

  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) {
    return apiKeyHeader.trim();
  }

  return null;
}
