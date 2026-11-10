/**
 * Presigned upload token utilities.
 *
 * Because Cloudflare R2 private buckets cannot issue usable presigned URLs
 * directly from Workers bindings (public access and a custom domain are
 * required), we implement presigned upload tokens as short-lived HMAC-SHA256
 * signed JWTs stored entirely in the URL.  This is a secure proxy approach:
 *   POST /api/v1/storage/namespaces/:ns/presign  → returns a token URL
 *   PUT  /api/v1/storage/presigned/[token]       → validates token, proxies upload
 */

export interface PresignedTokenPayload {
  tenantId: string;
  namespace: string;
  path: string;
  method: "GET" | "PUT";
  expiresAt: number; // Unix ms
}

// ---------------------------------------------------------------------------
// Secret helper
// ---------------------------------------------------------------------------

/**
 * Retrieves the HMAC signing secret.  Prefers the Cloudflare Workers `env`
 * binding when available, then falls back to `process.env.BETTER_AUTH_SECRET`.
 */
export async function getSecret(): Promise<string> {
  try {
    const { env } = await import("cloudflare:workers");
    const cfSecret = (env as unknown as Record<string, unknown>)
      .BETTER_AUTH_SECRET as string | undefined;
    if (cfSecret) return cfSecret;
  } catch {
    // Not running in Cloudflare Workers
  }

  const nodeSecret = process.env.BETTER_AUTH_SECRET;
  if (nodeSecret) return nodeSecret;

  throw new Error(
    "BETTER_AUTH_SECRET is not set. Configure this environment variable before using presigned tokens.",
  );
}

// ---------------------------------------------------------------------------
// Base64url helpers (no external deps — Web Crypto is available everywhere)
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + ((4 - (str.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Token creation / verification
// ---------------------------------------------------------------------------

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
 * Creates a compact signed token (header.payload.signature — base64url encoded).
 *
 * @param payload   The data to encode.
 * @param secret    HMAC signing secret.
 * @param expiresInSeconds  How many seconds the token is valid for.
 */
export async function createPresignedToken(
  payload: Omit<PresignedTokenPayload, "expiresAt">,
  secret: string,
  expiresInSeconds: number,
): Promise<string> {
  const fullPayload: PresignedTokenPayload = {
    ...payload,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  };

  const headerB64 = toBase64Url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "PST" })));
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(fullPayload)));
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
 *
 * @throws {Error} when the token is malformed, the signature does not match, or the token has expired.
 */
export async function verifyPresignedToken(
  token: string,
  secret: string,
): Promise<PresignedTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid presigned token format.");
  }

  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importKey(secret);
  const signatureBytes = fromBase64Url(sigB64);

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
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as PresignedTokenPayload;
  } catch {
    throw new Error("Presigned token payload is malformed.");
  }

  if (Date.now() > payload.expiresAt) {
    throw new Error("Presigned token has expired.");
  }

  return payload;
}
