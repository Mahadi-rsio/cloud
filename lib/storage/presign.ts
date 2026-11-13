/**
 * Presigned upload and download token utilities.
 *
 * Implements short-lived HMAC-SHA256 signed tokens (`header.payload.signature`)
 * with strict validation of header (`alg: "HS256"`, `typ: "PST"`), tenantId,
 * namespace, object path, HTTP method (`GET` | `PUT`), expiration, optional
 * content-type / max-size constraints, and optional single-use nonce tracking.
 */

import { generatePrefixedId, validatePath } from "./keys";

export interface PresignedTokenPayload {
  tenantId: string;
  namespace: string;
  path: string;
  method: "GET" | "PUT";
  expiresAt: number; // Unix ms
  contentType?: string;
  maxSizeBytes?: number;
  singleUse?: boolean;
  nonce?: string;
}

const CONSUMED_NONCES = new Map<string, number>();

function pruneConsumedNonces(): void {
  const now = Date.now();
  for (const [nonce, exp] of CONSUMED_NONCES) {
    if (exp <= now) CONSUMED_NONCES.delete(nonce);
  }
}

export function markPresignedTokenConsumed(payload: PresignedTokenPayload): boolean {
  if (!payload.singleUse || !payload.nonce) return true;
  pruneConsumedNonces();
  if (CONSUMED_NONCES.has(payload.nonce)) {
    return false;
  }
  CONSUMED_NONCES.set(payload.nonce, payload.expiresAt);
  return true;
}

export function resetConsumedPresignedTokens(): void {
  CONSUMED_NONCES.clear();
}

/**
 * Retrieves the HMAC signing secret. Prefers the Cloudflare Workers `env`
 * binding when available, then falls back to `process.env.BETTER_AUTH_SECRET`.
 */
export async function getSecret(): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const cfSecret = (env as unknown as Record<string, unknown>)
      .BETTER_AUTH_SECRET as string | undefined;
    if (cfSecret && cfSecret.length >= 16) return cfSecret;
  } catch {
    // Not running in Cloudflare Workers
  }

  const nodeSecret = process.env.BETTER_AUTH_SECRET;
  if (nodeSecret && nodeSecret.length >= 16) return nodeSecret;

  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return "test-only-fallback-presign-secret-key-32-bytes";
  }

  throw new Error(
    "BETTER_AUTH_SECRET is not set. Configure this environment variable before using presigned tokens.",
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Creates a compact signed token (`header.payload.signature` — base64url encoded).
 */
export async function createPresignedToken(
  payload: Omit<PresignedTokenPayload, "expiresAt">,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error("Presigned token secret must be at least 16 characters.");
  }
  if (payload.method !== "GET" && payload.method !== "PUT") {
    throw new Error("Invalid presigned token method.");
  }
  const pathCheck = validatePath(payload.path);
  if (!pathCheck.valid) {
    throw new Error(`Invalid presigned token path: ${pathCheck.error}`);
  }

  const fullPayload: PresignedTokenPayload = {
    ...payload,
    path: pathCheck.normalized,
    nonce: payload.nonce ?? (payload.singleUse ? generatePrefixedId("psn") : undefined),
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  const headerB64 = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "PST" })),
  );
  const payloadB64 = toBase64Url(
    new TextEncoder().encode(JSON.stringify(fullPayload)),
  );
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = toBase64Url(new Uint8Array(signatureBytes));

  return `${signingInput}.${sigB64}`;
}

/**
 * Verifies and decodes a presigned token.
 */
export async function verifyPresignedToken(
  token: string,
  secret: string,
): Promise<PresignedTokenPayload> {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid presigned token format.");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid presigned token format.");
  }

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  if (!headerB64 || !payloadB64 || !sigB64) {
    throw new Error("Invalid presigned token format.");
  }

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(headerB64)));
  } catch {
    throw new Error("Invalid presigned token header.");
  }
  if (header.alg !== "HS256" || header.typ !== "PST") {
    throw new Error("Unsupported presigned token algorithm.");
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(sigB64);
  } catch {
    throw new Error("Presigned token signature is invalid.");
  }

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as unknown as BufferSource,
    new TextEncoder().encode(signingInput),
  );

  if (!valid) {
    throw new Error("Presigned token signature is invalid.");
  }

  let payload: PresignedTokenPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadB64)),
    ) as PresignedTokenPayload;
  } catch {
    throw new Error("Presigned token payload is malformed.");
  }

  if (
    !payload ||
    typeof payload.tenantId !== "string" ||
    !payload.tenantId ||
    typeof payload.namespace !== "string" ||
    !payload.namespace ||
    typeof payload.path !== "string" ||
    !payload.path ||
    (payload.method !== "GET" && payload.method !== "PUT") ||
    typeof payload.expiresAt !== "number" ||
    !Number.isFinite(payload.expiresAt)
  ) {
    throw new Error("Presigned token payload is malformed.");
  }

  const pathCheck = validatePath(payload.path);
  if (!pathCheck.valid) {
    throw new Error("Presigned token contains an invalid path.");
  }
  payload.path = pathCheck.normalized;

  if (Date.now() > payload.expiresAt) {
    throw new Error("Presigned token has expired.");
  }

  return payload;
}
