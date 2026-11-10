#!/usr/bin/env node

/**
 * libSQL (sqld) Database and Tenant Management Utility
 * 
 * Supports:
 *  - Creating isolated tenant database namespaces
 *  - Generating Ed25519 cryptographic keypairs
 *  - Minting scoped JWT authentication tokens (read-write or read-only)
 *  - Generating connection URLs for libSQL client SDKs, Drizzle ORM, Prisma, etc.
 *  - Testing queries directly against the tenant database
 *  - Inspecting tenant performance and storage stats
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ADMIN_URL = process.env.SQLD_ADMIN_URL || 'http://127.0.0.1:8082';
const DATA_URL = process.env.SQLD_DATA_URL || 'http://127.0.0.1:8080';
const BASE_DOMAIN = process.env.SQLD_BASE_DOMAIN || 'cloudisy.top';
// Tenant subdomain pattern: {namespace}_cdb.cloudisy.top
const KEYS_DIR = path.join(__dirname, 'keys');

// Load Admin Auth Key from env or file if available
function getAdminAuthKey() {
  if (process.env.LIBSQL_ADMIN_AUTH_KEY) return process.env.LIBSQL_ADMIN_AUTH_KEY.trim();
  if (process.env.SQLD_ADMIN_AUTH_KEY) return process.env.SQLD_ADMIN_AUTH_KEY.trim();
  const keyFile = path.join(KEYS_DIR, 'admin_auth_key.txt');
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8').trim();
  }
  return null;
}

function getAdminHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const adminKey = getAdminAuthKey();
  if (adminKey) {
    headers['Authorization'] = `Basic ${adminKey}`;
  }
  return headers;
}

// Ensure keys directory exists with appropriate gitignore
if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}
const gitignorePath = path.join(KEYS_DIR, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, "*\n!.gitignore\n");
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * Generate Ed25519 keypair for tenant authentication
 */
export function generateKeypair(namespace) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const privFile = path.join(KEYS_DIR, `${namespace}.priv.pem`);
  const pubFile = path.join(KEYS_DIR, `${namespace}.pub.pem`);

  fs.writeFileSync(privFile, privPem, { mode: 0o600 });
  fs.writeFileSync(pubFile, pubPem, { mode: 0o644 });

  return { publicKey: pubPem, privateKey: privPem, privFile, pubFile };
}

/**
 * Sign a JWT token using Ed25519 (EdDSA)
 */
export function createToken(privateKeyPem, namespace, options = {}) {
  const scope = options.scope || 'rw'; // 'rw' or 'ro'
  const expiresInSeconds = options.expiresInSeconds || null;

  const header = {
    alg: 'EdDSA',
    typ: 'JWT'
  };

  const payload = {
    a: scope,
    ns: namespace,
    iat: Math.floor(Date.now() / 1000)
  };

  if (expiresInSeconds) {
    payload.exp = payload.iat + expiresInSeconds;
  }

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const message = `${headerB64}.${payloadB64}`;

  const signature = crypto.sign(null, Buffer.from(message), privateKeyPem).toString('base64url');
  return `${message}.${signature}`;
}

/**
 * Create a new tenant database namespace in sqld
 */
export async function createDatabase(namespace, options = {}) {
  console.log(`\n======================================================`);
  console.log(`Creating database for tenant: "${namespace}"`);
  console.log(`======================================================`);

  // 1. Generate cryptographic keys
  const keys = generateKeypair(namespace);
  console.log(`[1/4] Generated Ed25519 keypair for namespace: ${namespace}`);
  console.log(`      Private key: ${keys.privFile}`);
  console.log(`      Public key:  ${keys.pubFile}`);

  // 2. Call sqld Admin API to register namespace with its jwt_key
  console.log(`[2/4] Registering namespace with sqld Admin API (${ADMIN_URL})...`);
  const createRes = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}/create`, {
    method: 'POST',
    headers: getAdminHeaders(),
    body: JSON.stringify({
      jwt_key: keys.publicKey
    })
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    // If it already exists, update config
    if (createRes.status === 400 && errorText.includes('already exists')) {
      console.log(`      Namespace "${namespace}" already exists, updating jwt_key...`);
      const cfgRes = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}/config`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({
          jwt_key: keys.publicKey,
          block_reads: false,
          block_writes: false,
          block_reason: null,
          max_db_size: '1000.0 PB',
          heartbeat_url: null,
          allow_attach: false,
          txn_timeout_s: null,
          durability_mode: 'relaxed'
        })
      });
      if (!cfgRes.ok) {
        throw new Error(`Failed to update namespace config: ${await cfgRes.text()}`);
      }
    } else {
      throw new Error(`Failed to create namespace in sqld: ${errorText} (HTTP ${createRes.status})`);
    }
  }
  console.log(`      Namespace "${namespace}" successfully provisioned and secured!`);

  // 3. Mint JWT tokens
  console.log(`[3/4] Minting client authentication tokens...`);
  const rwToken = createToken(keys.privateKey, namespace, { scope: 'rw' });
  const roToken = createToken(keys.privateKey, namespace, { scope: 'ro' });

  // 4. Test query execution
  console.log(`[4/4] Verifying database connectivity and permissions...`);
  const testRes = await executeQuery(namespace, rwToken, "SELECT 'ready' as status, datetime('now') as created_at;");
  console.log(`      Connection verified! Result:`, JSON.stringify(testRes?.results?.[0]?.response?.result?.rows || testRes));

  // Connection URLs — tenant subdomain pattern: {namespace}_cdb.cloudisy.top
  const localUrl = `${DATA_URL}`;
  const localSubdomainUrl = `http://${namespace}.localhost:8080`;
  const prodUrl = `https://${namespace}_cdb.${BASE_DOMAIN}`;
  const prodLibsqlUrl = `libsql://${namespace}_cdb.${BASE_DOMAIN}`;

  console.log(`\n------------------------------------------------------`);
  console.log(`DATABASE PROVISIONED SUCCESSFULLY:`);
  console.log(`------------------------------------------------------`);
  console.log(`Tenant / Namespace : ${namespace}`);
  console.log(`Auth Token (RW)    : ${rwToken}`);
  console.log(`Auth Token (RO)    : ${roToken}`);
  console.log(`\nConnection URLs:`);
  console.log(`  Local HTTP URL   : ${localUrl} (with header 'x-namespace: ${namespace}')`);
  console.log(`  Local Subdomain  : ${localSubdomainUrl}`);
  console.log(`  Production HTTP  : ${prodUrl}`);
  console.log(`  Production libSQL: ${prodLibsqlUrl}`);
  console.log(`------------------------------------------------------\n`);

  return {
    namespace,
    authToken: rwToken,
    readOnlyToken: roToken,
    urls: {
      local: localUrl,
      localSubdomain: localSubdomainUrl,
      production: prodUrl,
      productionLibsql: prodLibsqlUrl
    }
  };
}

/**
 * Execute SQL statement on tenant database
 */
export async function executeQuery(namespace, token, sql) {
  const res = await fetch(`${DATA_URL}/v2/pipeline`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-namespace': namespace
    },
    body: JSON.stringify({
      requests: [
        {
          type: 'execute',
          stmt: { sql }
        }
      ]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Query failed: ${text} (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data;
}

/**
 * Fetch stats for a namespace
 */
export async function getStats(namespace) {
  const res = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}/stats`, {
    headers: getAdminHeaders()
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${await res.text()} (HTTP ${res.status})`);
  }
  return await res.json();
}

// CLI handler
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  try {
    switch (command) {
      case 'create': {
        const namespace = args[1] || 'test_user';
        await createDatabase(namespace);
        break;
      }
      case 'token': {
        const namespace = args[1];
        if (!namespace) {
          console.error("Usage: node manage.js token <namespace> [--ro] [--exp <seconds>]");
          process.exit(1);
        }
        const privFile = path.join(KEYS_DIR, `${namespace}.priv.pem`);
        if (!fs.existsSync(privFile)) {
          console.error(`Private key not found for namespace "${namespace}" at ${privFile}`);
          process.exit(1);
        }
        const privPem = fs.readFileSync(privFile, 'utf8');
        const isRo = args.includes('--ro');
        const expIdx = args.indexOf('--exp');
        const exp = expIdx !== -1 ? parseInt(args[expIdx + 1], 10) : null;
        const token = createToken(privPem, namespace, {
          scope: isRo ? 'ro' : 'rw',
          expiresInSeconds: exp
        });
        console.log(token);
        break;
      }
      case 'test': {
        const namespace = args[1] || 'test_user';
        const privFile = path.join(KEYS_DIR, `${namespace}.priv.pem`);
        let token = args[2];
        if (!token && fs.existsSync(privFile)) {
          token = createToken(fs.readFileSync(privFile, 'utf8'), namespace);
        }
        if (!token) {
          console.error(`No token provided and private key not found for namespace "${namespace}"`);
          process.exit(1);
        }
        const sql = args[3] || "SELECT 'Connected successfully!' as status, datetime('now') as time";
        console.log(`Running query on namespace "${namespace}":\n  SQL: ${sql}`);
        const result = await executeQuery(namespace, token, sql);
        console.log("Result:", JSON.stringify(result, null, 2));
        break;
      }
      case 'stats': {
        const namespace = args[1] || 'test_user';
        const stats = await getStats(namespace);
        console.log(`Stats for namespace "${namespace}":`, JSON.stringify(stats, null, 2));
        break;
      }
      case 'help':
      default:
        console.log(`
libSQL Database Management CLI

Usage:
  node manage.js create [namespace]             Create and secure a tenant database (default: test_user)
  node manage.js token <namespace> [--ro]       Mint a JWT token for a namespace
  node manage.js test <namespace> [token] [sql] Execute a test SQL query
  node manage.js stats <namespace>              Get query and storage stats for a namespace
`);
        break;
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('manage.js')) {
  main();
}
