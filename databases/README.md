# libSQL (`sqld`) Multi-Tenant SQLite Database Service

This directory contains the production Fly.io deployment configuration ([`fly.toml`](file:///workspaces/cloud/databases/fly.toml)), local development environment ([`docker-compose.yml`](file:///workspaces/cloud/databases/docker-compose.yml)), environment template ([`.env.example`](file:///workspaces/cloud/databases/.env.example)), management CLI ([`manage.js`](file:///workspaces/cloud/databases/manage.js)), and complete architectural documentation for self-hosting **libSQL Server (`sqld`)** in **Multi-Tenant Namespace Mode**.

---

## 1. Overview & Architecture

[libSQL](https://github.com/tursodatabase/libsql) is an open-source, SQLite-compatible database engine developed by [Turso](https://turso.tech). It transforms SQLite into a modern client-server database capable of running over HTTP, WebSockets (Hrana protocol), and gRPC.

### Why libSQL Multi-Tenancy for Platforms?

Traditional multi-tenancy models usually either:
1. **Share a single schema with a `tenant_id` column**: High risk of data leaks, complex row-level security, noisy neighbor resource starvation.
2. **Spin up dedicated containerized databases per tenant (e.g. Postgres)**: Expensive idle resources, slow provisioning (minutes), high memory footprint per tenant.

**libSQL Namespaces solve this:**
- **Per-Tenant SQLite Isolation**: Every tenant gets an independent SQLite database file (`data.db`), WAL log, schema, and quota.
- **Sub-Millisecond Cold Starts**: Databases are opened on demand from disk and automatically paged out of memory when idle.
- **Zero Idle Overhead**: Thousands of inactive tenant databases consume only disk storage; idle tenants consume 0 CPU and 0 RAM.
- **Single Machine, Instant Provisioning**: Creating, branching, or deleting a database namespace happens in **< 10ms** via the Admin API without spinning up additional Fly machines or containers.

```
                      ┌────────────────────────────────────────────────────────┐
                      │                  Fly.io Edge Network                   │
                      └──────────────┬──────────────────────────┬──────────────┘
                                     │                          │
                    HTTPS (Port 443) │         TLS (Port 8443)  │ Protected by
                   Public Data Plane │         Admin API Plane  │ LIBSQL_ADMIN_AUTH_KEY
                                     ▼                          ▼
                      ┌────────────────────────────────────────────────────────┐
                      │         libSQL Server (`sqld` on Fly Machine)          │
                      │                                                        │
                      │   Port 8080 (Internal): User HTTP & Hrana Data API     │
                      │   Port 8082 (Internal): Admin Namespace Management API │
                      └──────────────────────────┬─────────────────────────────┘
                                                 │
                   ┌─────────────────────────────┴─────────────────────────────┐
                   ▼                                                           ▼
         Tenant Namespace Routing:                                    Persistent Fly Volume
         - Subdomain: `tenant-a.db.domain.com`                        `/var/lib/sqld/data.sqld`
         - Header: `x-namespace: tenant-a`                            ├── dbs/
                                                                      │   ├── default/
                                                                      │   ├── tenant-a/ (data.db, wallog)
                                                                      │   └── tenant-b/ (data.db, wallog)
                                                                      └── metastore/
```

---

## 2. Server Configuration & Ports

| External Port | Internal Port | Protocol | Access Policy | Description |
|---|---|---|---|---|
| **`443`** (HTTP `80` &rarr; `443`) | **`8080`** | HTTP / Hrana / WS | **Public** (Edge TLS) | Query execution (`/v2/pipeline`), WebSocket streams (`/v1`), health checks (`/health`), and version (`/version`). Scoped by tenant JWT token. |
| **`8443`** | **`8082`** | HTTP (over TLS) | **Protected Admin API** | Secure external Admin API for external Next.js apps and platform control planes. Protected by `LIBSQL_ADMIN_AUTH_KEY`. |
| *Internal* | **`8082`** | HTTP | **Private 6PN Mesh** | Internal Admin API accessible within Fly private network at `http://libsql-database-service.internal:8082`. |
| *Internal* | **`5001`** | gRPC | **Private 6PN Mesh** | Internal replication protocol for primary-replica multi-region deployments. |

### Storage Layout

When `--enable-namespaces` is active, all databases are managed under `--db-path /var/lib/sqld/data.sqld`:
- `/var/lib/sqld/data.sqld/dbs/<namespace>/data.db` &mdash; SQLite database file for `<namespace>`.
- `/var/lib/sqld/data.sqld/dbs/<namespace>/wallog` &mdash; Write-Ahead Log replication entries.
- `/var/lib/sqld/data.sqld/metastore` &mdash; Namespace registry, schema configurations, and metadata.

> [!IMPORTANT]
> The storage volume (`sqld_data`) is attached directly to the Fly Machine. Namespaces are stored as independent SQLite database files on this mounted volume. Creating a new namespace **does not** create a new Fly Machine.

---

## 3. Detailed Environment Variables & Configuration Reference

This section details all environment variables and configuration secrets used across the server, secret vault, and consuming applications.

### 3.1 Server Runtime Environment Variables (`fly.toml` `[env]` or `docker-compose.yml`)

These variables govern `sqld` server execution and performance tuning:

| Variable Name | Type / Values | Default in `fly.toml` | Description |
|---|---|---|---|
| `SQLD_NODE` | `primary` \| `replica` | `primary` | Cluster topology role. `primary` handles all writes and local reads; `replica` receives WAL stream from primary. |
| `SQLD_HTTP_LISTEN_ADDR` | Socket address | `0.0.0.0:8080` | Internal network binding for the User Data Plane (HTTP pipeline, Hrana WebSockets, health check). |
| `SQLD_ADMIN_LISTEN_ADDR` | Socket address | `0.0.0.0:8082` | Internal network binding for the Admin Management API (namespace creation, stats, configs). |
| `SQLD_DB_PATH` | File path | `/var/lib/sqld/data.sqld` | Location on the persistent volume where SQLite databases, WAL logs, and the metastore catalog reside. |
| `SQLD_MAX_ACTIVE_NAMESPACES` | Integer | `100` | Maximum number of SQLite database handles kept concurrently resident in memory. Inactive databases are transparently paged out to disk to preserve RAM. |
| `SQLD_MAX_RESPONSE_SIZE` | Size string | `10MB` | Maximum permitted response payload size for a single SQL query execution. |
| `SQLD_MAX_TOTAL_RESPONSE_SIZE` | Size string | `32MB` | Maximum cumulative response payload size across all batch queries in an HTTP `/v2/pipeline` request. |
| `SQLD_DISABLE_DEFAULT_NAMESPACE` | Boolean (`true`/`false`) | *Unset* | When set to `true`, queries without an `x-namespace` or valid host header are rejected instead of falling back to the `default` namespace. |
| `SQLD_DISABLE_BOTTOMLESS` | Boolean (`true`/`false`) | *Unset* | Disables bottomless WAL S3 continuous replication even if S3 credentials are provided. |

---

### 3.2 Security & Authentication Secrets (`fly secrets set`)

These sensitive keys should **never** be committed to version control. They are injected as Fly encrypted secrets:

| Secret Name | Format | Required | Description |
|---|---|---|---|
| `LIBSQL_ADMIN_AUTH_KEY` | 64-char hex / alphanumeric | **Yes** | Master authentication secret protecting the Admin API on port `8443` (and internal `8082`). Must be passed in HTTP requests via `Authorization: Basic <key>`. Requests without this key return `401 Unauthorized`. |
| `SQLD_AUTH_JWT_KEY` | PEM string (Ed25519 Public Key) | Optional | Server-wide public key for verifying tenant JWT tokens on the Data Plane (`443`). Alternatively, public keys can be passed per-namespace during creation via `jwt_key`. |
| `SQLD_AUTH_JWT_KEY_FILE` | Absolute file path | Optional | Path to a PEM file containing the server-wide Ed25519 public key. |

To set or rotate secrets on Fly.io:
```bash
fly secrets set LIBSQL_ADMIN_AUTH_KEY="your_secure_random_key" -a libsql-database-service
```

---

### 3.3 S3 Metastore & WAL Backup Variables (Optional Bottomless Replication)

To continuously back up tenant databases and metastore catalogs to S3-compatible object storage (Fly Tigris, Cloudflare R2, AWS S3):

| Variable Name | Example Value | Description |
|---|---|---|
| `SQLD_BACKUP_META_STORE` | `true` | Enables continuous metastore backup to S3. |
| `SQLD_META_STORE_BUCKET_NAME` | `my-sqld-backups` | Target bucket name. |
| `SQLD_META_STORE_BUCKET_ENDPOINT` | `https://fly.storage.tigris.dev` | S3 API endpoint URL (use Cloudflare R2 or AWS S3 endpoint if applicable). |
| `SQLD_META_STORE_ACCESS_KEY_ID` | `tid_...` | S3 API Access Key ID. |
| `SQLD_META_STORE_SECRET_ACCESS` | `tsec_...` | S3 API Secret Access Key. |
| `SQLD_META_STORE_REGION` | `auto` (or `iad`, `us-east-1`) | Bucket region. |
| `SQLD_META_STORE_BACKUP_ID` | `primary-cluster` | Unique identifier for the cluster backup snapshot set. |

---

### 3.4 Platform Control Plane & Client Application Variables (`.env.local` / `.dev.vars`)

Consumed by external applications (e.g. your Next.js dashboard, backend workers, or [`manage.js`](file:///workspaces/cloud/databases/manage.js)):

| Environment Variable | Recommended Value | Description |
|---|---|---|
| `LIBSQL_ADMIN_URL` | `https://libsql-database-service.fly.dev:8443` | URL of the protected Admin API used to provision and delete tenant databases. (Use `http://localhost:8082` in local development). |
| `LIBSQL_DATA_URL` | `https://libsql-database-service.fly.dev` | URL of the public Data Plane used by client SDKs to execute queries. (Use `http://localhost:8080` in local development). |
| `LIBSQL_ADMIN_AUTH_KEY` | *(Secret value)* | The admin secret key used in `Authorization: Basic <key>` headers when calling the Admin API. |
| `LIBSQL_BASE_DOMAIN` | `db.yourplatform.com` | Base domain for wildcard tenant routing (e.g. `<tenant-id>.db.yourplatform.com`). |
| `TENANT_JWT_TOKEN` | *(Minted Ed25519 JWT)* | Per-tenant scoped bearer token passed to client SDKs (`@libsql/client`, Drizzle, etc.). |

---

## 4. Tenant Namespace Routing

When client queries arrive on port `443` (internal `8080`), `sqld` determines the target database using the following resolution priority:

### Method A: HTTP Header Routing (`x-namespace`)

Clients pass the target tenant name directly in the request header:
```bash
curl -X POST https://libsql-database-service.fly.dev/v2/pipeline \
  -H "Authorization: Bearer <TENANT_JWT_TOKEN>" \
  -H "x-namespace: customer_42" \
  -H "Content-Type: application/json" \
  -d '{"requests": [{"type": "execute", "stmt": {"sql": "SELECT 1;"}}]}'
```

### Method B: Subdomain Routing (Host Header)

The first label of the incoming `Host` header automatically resolves to the namespace:
- `customer-42.db.yourplatform.com` &rarr; routes to namespace `customer-42`
- `acme-corp.db.yourplatform.com` &rarr; routes to namespace `acme-corp`

*(If no namespace can be identified from header or host, `sqld` defaults to the `default` namespace unless `--disable-default-namespace` is passed).*

---

## 5. Admin API Reference (Port 8443)

The Admin API runs on external port **`8443`** with TLS (or internal port `8082` over 6PN). All requests to the Admin API require authentication via the `LIBSQL_ADMIN_AUTH_KEY`.

### Authentication Scheme

`sqld` requires the admin authentication key to be passed using HTTP Basic authentication format:

```bash
# Production Admin Endpoint with Basic Auth:
curl -H "Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>" \
  https://libsql-database-service.fly.dev:8443/v1/namespaces
```

Unauthenticated requests or requests with an invalid key return `401 Unauthorized`.

---

### 1. Create a Namespace

Provisions a new isolated database namespace in `< 10ms`. Pass a `jwt_key` (Ed25519 public key in PEM format) to cryptographically lock down and secure the tenant's database:

```bash
POST https://libsql-database-service.fly.dev:8443/v1/namespaces/{namespace}/create
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
Content-Type: application/json

{
  "jwt_key": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA...-----END PUBLIC KEY-----\n"
}
```

**Optional Request Body Fields:**
```json
{
  "jwt_key": "-----BEGIN PUBLIC KEY-----\n...",
  "dump_url": "https://storage.example.com/seeds/schema.sql"
}
```
*Response: `200 OK` (Empty body)*

---

### 2. Fork a Namespace (Branching)

Instantly clones an existing namespace into a new target namespace (copy-on-write branching):

```bash
POST https://libsql-database-service.fly.dev:8443/v1/namespaces/{source_namespace}/fork/{target_namespace}
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
Content-Type: application/json

{}
```
*Response: `200 OK` (Empty body)*

---

### 3. Delete a Namespace

Permanently deletes a namespace and removes its SQLite database files from disk:

```bash
DELETE https://libsql-database-service.fly.dev:8443/v1/namespaces/{namespace}
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
```
*Response: `200 OK` (Empty body)*

---

### 4. Inspect Namespace Status & Config

Fetches configuration and metadata for a given namespace:

```bash
GET https://libsql-database-service.fly.dev:8443/v1/namespaces/{namespace}/config
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
```

---

### 5. Fetch Performance & Query Statistics

Returns real-time execution statistics, storage usage, top queries, and latency percentiles (p50, p75, p90, p95, p99):

```bash
GET https://libsql-database-service.fly.dev:8443/v1/namespaces/{namespace}/stats
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
```

**Example Response:**
```json
{
  "id": "353bb70f-9795-4622-9f44-258b6ebc6eb2",
  "rows_read_count": 420,
  "rows_written_count": 18,
  "storage_bytes_used": 40960,
  "replication_index": 12,
  "top_queries": [
    {
      "query": "SELECT * FROM users WHERE active = 1;",
      "rows_read": 350,
      "rows_written": 0
    }
  ],
  "queries": {
    "count": 45,
    "elapsed": {
      "p50": 0.082,
      "p90": 0.450,
      "p99": 1.250,
      "sum": 14.80
    }
  }
}
```

---

### 6. Force WAL Checkpoint

Flushes all WAL frame logs into the primary SQLite database file:

```bash
POST https://libsql-database-service.fly.dev:8443/v1/namespaces/{namespace}/checkpoint
Authorization: Basic <LIBSQL_ADMIN_AUTH_KEY>
```

---

## 6. Tenant Authentication & Token Generation (Ed25519 / JWT)

libSQL supports stateless cryptographic token authentication using **Ed25519 (EdDSA)** keypairs:
1. **Public Key on Server**: Registered once in `sqld` namespace config via the Admin API (`jwt_key`).
2. **Private Key with Platform**: Kept secret by your platform or Next.js control plane.
3. **Local Token Minting**: Next.js mints scoped JWT tokens in microseconds (`< 0.1ms`) without making network calls to `sqld`.
4. **Cryptographic Isolation**: A token generated for `tenant-a` is cryptographically rejected by `tenant-b` (HTTP `401 Unauthorized`).

### Token Structure
- **Header**: `{"alg": "EdDSA", "typ": "JWT"}`
- **Payload**:
  - `ns`: Target namespace (e.g. `"tenant_123"`).
  - `a`: Permissions (`"rw"` for Read/Write, `"ro"` for Read-Only).
  - `iat`: Timestamp issued at.
  - `exp`: (Optional) Expiration timestamp.

### Quick Management CLI ([`manage.js`](file:///workspaces/cloud/databases/manage.js))

The management CLI automatically picks up `LIBSQL_ADMIN_AUTH_KEY` from the environment or [`databases/keys/admin_auth_key.txt`](file:///workspaces/cloud/databases/keys/admin_auth_key.txt):

```bash
# Create and secure a tenant namespace against local or remote Fly instance:
SQLD_ADMIN_URL=https://libsql-database-service.fly.dev:8443 \
SQLD_DATA_URL=https://libsql-database-service.fly.dev \
node databases/manage.js create customer_abc

# Mint a fresh JWT token for a namespace:
node databases/manage.js token customer_abc --ro
node databases/manage.js token customer_abc --exp 3600

# Run a test query:
node databases/manage.js test customer_abc

# Inspect real-time query latency and storage stats:
SQLD_ADMIN_URL=https://libsql-database-service.fly.dev:8443 \
node databases/manage.js stats customer_abc
```

---

## 7. External Next.js App Integration

Here is the production integration module for provisioning tenant databases and minting tokens from your Next.js application or platform control plane:

### 1. Database Provisioning Service (`lib/tenant-db.ts`)

```typescript
import crypto from "node:crypto";

const ADMIN_URL = process.env.LIBSQL_ADMIN_URL || "https://libsql-database-service.fly.dev:8443";
const DATA_URL = process.env.LIBSQL_DATA_URL || "https://libsql-database-service.fly.dev";
const ADMIN_AUTH_KEY = process.env.LIBSQL_ADMIN_AUTH_KEY!;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export interface TenantKeypair {
  publicKey: string;
  privateKey: string;
}

export interface TenantDatabaseCredentials {
  namespace: string;
  databaseUrl: string;
  authToken: string;
  readOnlyToken: string;
}

/**
 * Generates an Ed25519 keypair for securing a tenant database.
 */
export function generateTenantKeypair(): TenantKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/**
 * Mints an Ed25519 JWT token locally without any network calls (< 0.1ms).
 */
export function mintTenantToken(
  namespace: string,
  privateKeyPem: string,
  options: { scope?: "rw" | "ro"; expiresInSeconds?: number } = {}
): string {
  const header = { alg: "EdDSA", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    a: options.scope || "rw",
    ns: namespace,
    iat: now,
  };
  if (options.expiresInSeconds) {
    payload.exp = now + options.expiresInSeconds;
  }

  const message = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign(null, Buffer.from(message), privateKeyPem).toString("base64url");
  return `${message}.${signature}`;
}

/**
 * Provisions a new tenant database namespace on Fly.io via the Admin API.
 */
export async function createTenantDatabase(
  namespace: string,
  publicKeyPem: string
): Promise<void> {
  const res = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${ADMIN_AUTH_KEY}`,
    },
    body: JSON.stringify({ jwt_key: publicKeyPem }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create tenant database (${res.status}): ${errorText}`);
  }
}

/**
 * Clones/branches a database instantly (e.g. for preview environments).
 */
export async function forkTenantDatabase(source: string, target: string): Promise<void> {
  const res = await fetch(`${ADMIN_URL}/v1/namespaces/${source}/fork/${target}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${ADMIN_AUTH_KEY}`,
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(`Failed to fork database: ${await res.text()}`);
  }
}

/**
 * Deletes a tenant database namespace and frees storage.
 */
export async function deleteTenantDatabase(namespace: string): Promise<void> {
  const res = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Basic ${ADMIN_AUTH_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to delete database: ${await res.text()}`);
  }
}

/**
 * Fetches query and storage metrics for a tenant database.
 */
export async function getTenantStats(namespace: string): Promise<unknown> {
  const res = await fetch(`${ADMIN_URL}/v1/namespaces/${namespace}/stats`, {
    headers: {
      "Authorization": `Basic ${ADMIN_AUTH_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to get stats: ${await res.text()}`);
  }
  return await res.json();
}
```

### 2. Next.js API Route Example (`app/api/v1/databases/route.ts`)

```typescript
import { NextResponse } from "next/server";
import {
  generateTenantKeypair,
  createTenantDatabase,
  mintTenantToken,
} from "@/lib/tenant-db";

export async function POST(req: Request) {
  const { tenantId } = await req.json();

  if (!tenantId || !/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    return NextResponse.json({ error: "Invalid tenant ID" }, { status: 400 });
  }

  // 1. Generate Ed25519 keypair
  const keys = generateTenantKeypair();

  // 2. Call sqld Admin API to provision namespace
  await createTenantDatabase(tenantId, keys.publicKey);

  // 3. Mint initial Read/Write token
  const authToken = mintTenantToken(tenantId, keys.privateKey, { scope: "rw" });
  const readOnlyToken = mintTenantToken(tenantId, keys.privateKey, { scope: "ro" });

  // 4. Store privateKey in your platform database (e.g. Neon PostgreSQL)
  // await db.insert(tenantDatabases).values({ tenantId, privateKey: keys.privateKey });

  return NextResponse.json({
    tenantId,
    databaseUrl: `https://libsql-database-service.fly.dev`,
    headers: { "x-namespace": tenantId },
    authToken,
    readOnlyToken,
  });
}
```

---

## 8. Querying the Database (Data API)

### TypeScript / Node.js SDK (`@libsql/client`)

```bash
npm install @libsql/client
```

```typescript
import { createClient } from "@libsql/client";

const client = createClient({
  url: "https://libsql-database-service.fly.dev",
  authToken: process.env.TENANT_JWT_TOKEN,
  headers: {
    "x-namespace": "customer_42",
  },
});

async function main() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );
  `);

  await client.execute({
    sql: "INSERT INTO users (name, email) VALUES (?, ?)",
    args: ["Alice", "alice@example.com"],
  });

  const res = await client.execute("SELECT * FROM users");
  console.log("Users:", res.rows);
}

main();
```

### Drizzle ORM (Node.js / TypeScript)

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

const client = createClient({
  url: "https://libsql-database-service.fly.dev",
  authToken: process.env.TENANT_JWT_TOKEN,
  headers: { "x-namespace": "customer_42" },
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
});

export const db = drizzle(client);
```

### Python SDK (`libsql-client`)

```python
import os
import libsql_client

client = libsql_client.create_client_sync(
    url="https://libsql-database-service.fly.dev",
    auth_token=os.environ.get("TENANT_JWT_TOKEN"),
)

client.execute("INSERT INTO items (title) VALUES (?);", ["First Item"])
```

### Go Driver (`github.com/tursodatabase/libsql-client-go`)

```go
package main

import (
    "database/sql"
    _ "github.com/tursodatabase/libsql-client-go/libsql"
)

func main() {
    url := "https://libsql-database-service.fly.dev?authToken=" + os.Getenv("TENANT_JWT_TOKEN")
    db, err := sql.Open("libsql", url)
    // ...
}
```

---

## 9. Local Development with Docker Compose

To run the multi-tenant database service locally using Docker Compose:

```bash
cd databases
docker compose up -d
```

Verify service availability:
```bash
# Check health
curl -i http://localhost:8080/health

# Create a local tenant namespace
curl -X POST http://localhost:8082/v1/namespaces/dev_tenant/create \
  -H "Content-Type: application/json" \
  -d '{}'

# Query local tenant database
curl -X POST http://localhost:8080/v2/pipeline \
  -H "x-namespace: dev_tenant" \
  -H "Content-Type: application/json" \
  -d '{"requests": [{"type": "execute", "stmt": {"sql": "SELECT \x27Local libSQL ready!\x27 as message;"}}]}'
```

---

## 10. Fly.io Production Deployment & Volume Verification

### Persistent Volume Verification

The production app `libsql-database-service` is mounted to a Fly volume:
- **Volume ID**: `vol_vjy9kek5g6j11ypv`
- **Volume Name**: `sqld_data`
- **Size**: 1 GB (encrypted)
- **Mount Path**: `/var/lib/sqld`
- **Machine**: `82dd324c766358` (`snowy-feather-8932` in region `iad`)

To verify volume attachment and status:
```bash
fly volumes list -a libsql-database-service
```

### Automated Multi-Language Verification Suite

Run the end-to-end verification suite across Drizzle, Kysely, SQLAlchemy, and GORM:
```bash
./databases/test_all_orms.sh test_user
```

---

## 11. Backup & Disaster Recovery

Fly.io automatically performs daily volume snapshots. In addition, `sqld` supports backing up the metastore and SQLite WAL to any S3-compatible bucket (Tigris, R2, AWS S3):

```bash
fly secrets set \
  SQLD_BACKUP_META_STORE=true \
  SQLD_META_STORE_BUCKET_NAME=my-sqld-backups \
  SQLD_META_STORE_BUCKET_ENDPOINT=https://fly.storage.tigris.dev \
  SQLD_META_STORE_ACCESS_KEY_ID=your_access_key \
  SQLD_META_STORE_SECRET_ACCESS=your_secret_key \
  SQLD_META_STORE_REGION=auto \
  SQLD_META_STORE_BACKUP_ID=primary-cluster \
  -a libsql-database-service
```
