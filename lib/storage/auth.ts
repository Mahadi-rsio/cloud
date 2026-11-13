/**
 * API key hashing, generation, verification, and strict scope validation.
 * Uses standard Web Crypto (SHA-256) so it runs identically in Node.js and Cloudflare Workers.
 */

export type ApiKeyEnvironment = "live" | "test";

export const ALLOWED_STORAGE_SCOPES = [
  "storage:read",
  "storage:write",
  "storage:delete",
  "storage:admin",
] as const;

export type StorageScope = (typeof ALLOWED_STORAGE_SCOPES)[number] | "*";

const ALLOWED_SCOPE_SET = new Set<string>(ALLOWED_STORAGE_SCOPES);

export interface GeneratedApiKey {
  /** The full plaintext key to display to the user once upon creation */
  key: string;
  /** Safe prefix to store and display in UI (e.g., sk_live_a1b2c3d4) */
  prefix: string;
  /** SHA-256 hash to persist in database */
  keyHash: string;
}

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

/**
 * Generates a cryptographically secure, prefixed API key (`sk_live_...` or `sk_test_...`).
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

/**
 * Validate a list or comma/JSON string of scopes against the strict allowlist.
 * Rejects unknown permission names, wildcard `*` from client payloads, and empty scopes.
 */
export function validateStorageScopes(
  rawScopes: string | string[] | null | undefined,
): { valid: boolean; scopes: StorageScope[]; invalidScopes: string[] } {
  let list: string[] = [];
  if (Array.isArray(rawScopes)) {
    list = rawScopes.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof rawScopes === "string") {
    const trimmed = rawScopes.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          list = parsed.map((s) => String(s).trim()).filter(Boolean);
        }
      } catch {
        return { valid: false, scopes: [], invalidScopes: [trimmed] };
      }
    } else if (trimmed.length > 0) {
      list = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  if (list.length === 0) {
    return { valid: false, scopes: [], invalidScopes: [] };
  }

  const invalidScopes = list.filter((s) => !ALLOWED_SCOPE_SET.has(s));
  if (invalidScopes.length > 0) {
    return { valid: false, scopes: [], invalidScopes };
  }

  const unique = Array.from(new Set(list)) as StorageScope[];
  return { valid: true, scopes: unique, invalidScopes: [] };
}

/**
 * Parse a scopes string (comma-separated or JSON array) into a Set of valid scopes.
 * Never interprets missing or empty scopes as unrestricted.
 */
export function parseScopes(scopes: string | string[] | null | undefined): Set<string> {
  if (!scopes) return new Set();
  let list: string[] = [];
  if (Array.isArray(scopes)) {
    list = scopes.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof scopes === "string") {
    const trimmed = scopes.trim();
    if (!trimmed) return new Set();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          list = parsed.map((s) => String(s).trim()).filter(Boolean);
        }
      } catch {
        return new Set();
      }
    } else {
      list = trimmed
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const valid = new Set<string>();
  for (const s of list) {
    if (ALLOWED_SCOPE_SET.has(s) || s === "*") {
      valid.add(s);
    }
  }
  return valid;
}

/**
 * Check if the given scopes satisfy the required scope.
 * - Missing or empty scopes never grant access.
 * - Unknown required scopes are rejected.
 * - `storage:admin` or `*` grants administrative and storage operations.
 * - `storage:write` implies `storage:read`, but never `storage:delete` or `storage:admin`.
 */
export function hasScope(
  grantedScopes: string | string[] | Set<string> | null | undefined,
  requiredScope: StorageScope | string,
): boolean {
  if (!ALLOWED_SCOPE_SET.has(requiredScope) && requiredScope !== "*") {
    return false;
  }
  const set = grantedScopes instanceof Set ? grantedScopes : parseScopes(grantedScopes);
  if (set.size === 0) return false;
  if (set.has("*") || set.has("storage:admin")) return true;
  if (requiredScope === "storage:admin") return false;
  if (set.has(requiredScope)) return true;
  if (requiredScope === "storage:read" && set.has("storage:write")) return true;
  return false;
}

/**
 * Redact an API key so full secrets are never exposed in logs.
 */
export function redactApiKey(rawKey: string | null | undefined): string {
  if (!rawKey) return "<none>";
  if (rawKey.length <= 12) return "***";
  return `${rawKey.slice(0, 10)}...`;
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
