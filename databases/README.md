# libSQL (`sqld`) Multi-Tenant SQLite Database Service

This directory contains the production Fly.io deployment configuration (`fly.toml`), local development environment (`docker-compose.yml`), and complete architectural documentation for self-hosting **libSQL Server (`sqld`)** in **Multi-Tenant Namespace Mode**.

---

## 1. Overview & Architecture

[libSQL](https://github.com/tursodatabase/libsql) is an open-source, SQLite-compatible database engine developed by [Turso](https://turso.tech). It transforms SQLite into a modern client-server database capable of running over HTTP, WebSockets (Hrana protocol), and gRPC.

### Why libSQL Multi-Tenancy for Platforms?

Traditional multi-tenancy models usually either:
1. **Share a single schema with a `tenant_id` column**: High risk of data leaks, complex row-level security, noisy neighbor resource starvation.
2. **Spin up dedicated containerized databases per tenant (e.g. Postgres)**: Expensive idle resources, slow provisioning (minutes), high memory footprint per tenant.

**libSQL Namespaces solve this:**
- **Per-Tenant SQLite Isolation**: Every tenant gets an independent SQLite database file (`.db`), WAL log, schema, and quota.
- **Sub-Millisecond Cold Starts**: Databases are opened on demand from disk and automatically paged out of memory when idle.
- **Zero Idle Overhead**: Thousands of inactive tenant databases consume only disk storage; idle tenants consume 0 CPU and 0 RAM.
- **Instant Provisioning & Branching**: Creating or forking a database namespace happens in under 5 milliseconds via an HTTP API.

```
                      ┌────────────────────────────────────────┐
                      │          Fly.io Edge Network           │
                      └──────────────────┬─────────────────────┘
                                         │ HTTPS (Port 443)
                                         ▼
                      ┌────────────────────────────────────────┐
                      │    libSQL Server (`sqld` on Fly)       │
                      │                                        │
                      │  Port 8080: User HTTP / Hrana Protocol │
                      │  Port 8082: Admin Management API       │
                      └──────────────────┬─────────────────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
           Tenant Routing:                           Persistent Fly Volume
           - Subdomain: `tenant-a.db.domain.com`     `/var/lib/sqld/data.sqld`
           - Header: `x-namespace: tenant-a`         ├── dbs/
                                                     │   ├── default/
                                                     │   ├── tenant-a/ (data.db, wal)
                                                     │   └── tenant-b/ (data.db, wal)
                                                     └── metastore/
```

---

## 2. Server Configuration & Ports

| Port | Service | Access Policy | Description |
|---|---|---|---|
| **`8080`** | **User HTTP / Hrana** | Public (via Fly Proxy HTTPS) | Query execution (`/v2/pipeline`), WebSocket streams (`/v1`), health checks (`/health`), and version (`/version`). |
| **`8082`** | **Admin API** | Private (Fly 6PN / WireGuard) | Namespace lifecycle management (create, fork, delete, configure, stats). Protected from public internet exposure. |
| **`5001`** | **gRPC Replication** | Private (Internal only) | Replication protocol for primary-replica multi-region deployments. |

### Storage Layout

When `--enable-namespaces` is enabled, all databases are managed under `--db-path /var/lib/sqld/data.sqld`:
- `/var/lib/sqld/data.sqld/dbs/<namespace>/data.db` &mdash; SQLite database file for `<namespace>`.
- `/var/lib/sqld/data.sqld/dbs/<namespace>/wallog` &mdash; Write-Ahead Log replication entries.
- `/var/lib/sqld/data.sqld/metastore` &mdash; Namespace registry, schema configurations, and metadata.

---

## 3. Tenant Namespace Routing

When client queries arrive on port `8080`, `sqld` determines the target database using the following resolution priority:

### Method A: HTTP Header Routing (`x-namespace`)

Clients pass the target tenant name directly in the request header:
```bash
curl -X POST http://localhost:8080/v2/pipeline \
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

## 4. Complete Admin API Reference

The Admin API runs on port `8082`. On Fly.io, it is bound to Fly's private 6PN mesh network (`<app-name>.internal:8082`) or accessed via `fly proxy 8082:8082 -a <app-name>`.

### 1. Create a Namespace
Provisions a new isolated database namespace.

```bash
POST /v1/namespaces/{namespace}/create
Content-Type: application/json

{}
```

**Optional Request Body:**
```json
{
  "dump_url": "https://storage.example.com/seeds/schema.sql"
}
```
*Response: `200 OK` (Empty body)*

### 2. Fork a Namespace
Instantly clones an existing namespace into a new target namespace (copy-on-write branching):

```bash
POST /v1/namespaces/{source_namespace}/fork/{target_namespace}
Content-Type: application/json

{}
```
*Response: `200 OK` (Empty body)*

### 3. Delete a Namespace
Permanently deletes a namespace and removes its SQLite database files from disk:

```bash
DELETE /v1/namespaces/{namespace}
```
*Response: `200 OK` (Empty body)*

### 4. Inspect Namespace Status
Fetches metadata and configuration for a given namespace:

```bash
GET /v1/namespaces/{namespace}
```

### 5. Fetch Performance & Query Statistics
Returns real-time execution statistics, storage usage, top queries, and latency percentiles (p50, p75, p90, p95, p99):

```bash
GET /v1/namespaces/{namespace}/stats
```

**Example Response:**
```json
{
  "id": "0e850351-d2a3-41ec-8a61-502c580f7270",
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

### 6. Force WAL Checkpoint
Flushes all WAL frame logs into the primary SQLite database file:

```bash
POST /v1/namespaces/{namespace}/checkpoint
```

### 7. Prometheus Metrics
Exposes Prometheus-compatible metric gauges and counters for server monitoring:

```bash
GET /metrics
```

---

## 5. Querying the Database (Data API)

### 1. Direct HTTP Pipeline (`POST /v2/pipeline`)

Send batch SQL statements in a single round-trip:

```bash
curl -X POST https://libsql-database-service.fly.dev/v2/pipeline \
  -H "x-namespace: tenant1" \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [
      {
        "type": "execute",
        "stmt": {
          "sql": "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT);"
        }
      },
      {
        "type": "execute",
        "stmt": {
          "sql": "INSERT INTO users (name, email) VALUES (?, ?);",
          "args": [{"type": "text", "value": "Alice"}, {"type": "text", "value": "alice@example.com"}]
        }
      },
      {
        "type": "execute",
        "stmt": {
          "sql": "SELECT id, name, email FROM users;"
        }
      }
    ]
  }'
```

### 2. TypeScript / Node.js SDK (`@libsql/client`)

Install the official client:
```bash
npm install @libsql/client
```

Connect using HTTP/WebSocket with namespace routing:

```typescript
import { createClient } from "@libsql/client";

// Option A: Using subdomain routing
const client = createClient({
  url: "https://tenant1.db.yourplatform.com",
  // authToken: process.env.TENANT_JWT_TOKEN // if namespace auth is enabled
});

// Option B: Using x-namespace header
const tenantClient = createClient({
  url: "https://libsql-database-service.fly.dev",
  headers: {
    "x-namespace": "tenant1",
  },
});

async function main() {
  await tenantClient.execute(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
  `);

  await tenantClient.execute({
    sql: "INSERT INTO items (title) VALUES (?)",
    args: ["First Item"],
  });

  const rs = await tenantClient.execute("SELECT * FROM items");
  console.log("Items:", rs.rows);
}

main();
```

### 3. Drizzle ORM Integration

```typescript
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const client = createClient({
  url: "https://libsql-database-service.fly.dev",
  headers: {
    "x-namespace": "tenant1",
  },
});

export const db = drizzle(client);
```

### 4. Python SDK (`libsql-client`)

```bash
pip install libsql-client
```

```python
import libsql_client

client = libsql_client.create_client_sync(
    url="https://libsql-database-service.fly.dev",
    headers={"x-namespace": "tenant1"}
)

client.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, content TEXT);")
client.execute("INSERT INTO notes (content) VALUES ('Meeting notes');")
rows = client.execute("SELECT * FROM notes;")
print(rows)
```

---

## 6. Fly.io Production Deployment

The provided [`fly.toml`](file:///workspaces/cloud/databases/fly.toml) is pre-configured with:
- `ghcr.io/tursodatabase/libsql-server:latest`
- Automatic namespace enablement via `/bin/sqld --enable-namespaces --db-path /var/lib/sqld/data.sqld`
- Persistent volume mount (`sqld_data`) at `/var/lib/sqld`
- Built-in health checks on `/health`
- Private Admin API on port `8082`

### Step 1: Install & Authenticate with `flyctl`

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Log in
fly auth login
```

### Step 2: Initialize the App

Navigate to the `databases/` directory:
```bash
cd databases
```

If you wish to change the application name, edit `app = "your-app-name"` in `fly.toml` or launch with:
```bash
fly launch --copy-config --name my-platform-libsql --region iad --no-deploy
```

### Step 3: Create the Persistent Volume

A persistent volume is **mandatory** so that database files survive machine restarts and redeployments:

```bash
fly volumes create sqld_data --region iad --size 10
```
*(Adjust `--size` in GB based on anticipated storage needs. Volumes can be expanded dynamically later).*

### Step 4: Deploy

```bash
fly deploy
```

### Step 5: Verify Deployment

Check the machine status:
```bash
fly status
fly logs
```

Test the health check endpoint:
```bash
curl -i https://libsql-database-service.fly.dev/health
# HTTP/1.1 200 OK
```

### Step 6: Accessing the Admin API on Fly.io

Because port `8082` is kept private for security, you can interact with the Admin API using Fly WireGuard proxying:

```bash
# In terminal A: establish local tunnel to remote port 8082
fly proxy 8082:8082 -a libsql-database-service

# In terminal B: create a tenant database
curl -X POST http://localhost:8082/v1/namespaces/client_alpha/create \
  -H "Content-Type: application/json" \
  -d '{}'
```

Alternatively, any other app deployed inside your Fly.io organization can reach the Admin API directly over internal DNS:
```
http://libsql-database-service.internal:8082/v1/namespaces/{namespace}/create
```

### Step 7: Wildcard Subdomain & Custom SSL (Optional)

To enable automatic subdomain routing like `tenant1.db.yourplatform.com`:
1. Add a wildcard CNAME record in your DNS provider:
   `*.db.yourplatform.com` &rarr; `<your-app-name>.fly.dev`
2. Allocate a dedicated Fly IPv4 and IPv6:
   ```bash
   fly ips allocate-v4
   fly ips allocate-v6
   ```
3. Issue a wildcard certificate via Fly.io:
   ```bash
   fly certs add *.db.yourplatform.com
   ```

---

## 7. Local Development with Docker Compose

To test multi-tenant libSQL locally before deploying:

```bash
cd databases

# Start sqld container
docker compose up -d

# Verify logs
docker compose logs -f

# Check health
curl -i http://localhost:8080/health

# Create tenant namespace
curl -X POST http://localhost:8082/v1/namespaces/dev_tenant/create \
  -H "Content-Type: application/json" \
  -d '{}'

# Query tenant database
curl -X POST http://localhost:8080/v2/pipeline \
  -H "x-namespace: dev_tenant" \
  -H "Content-Type: application/json" \
  -d '{"requests": [{"type": "execute", "stmt": {"sql": "SELECT \x27Hello Multi-Tenant libSQL!\x27 as greeting;"}}]}'

# Fetch tenant statistics
curl -s http://localhost:8082/v1/namespaces/dev_tenant/stats | jq

# Stop container
docker compose down
```

---

## 8. Backup & Replication Options

In addition to Fly.io automated volume snapshots (`fly volumes list`), `sqld` supports backing up the metadata store and SQLite WAL to any S3-compatible storage (such as Fly Tigris, Cloudflare R2, or AWS S3).

To enable metastore backup, set the following secrets on Fly:
```bash
fly secrets set \
  SQLD_BACKUP_META_STORE=true \
  SQLD_META_STORE_BUCKET_NAME=my-sqld-backups \
  SQLD_META_STORE_BUCKET_ENDPOINT=https://fly.storage.tigris.dev \
  SQLD_META_STORE_ACCESS_KEY_ID=your_access_key \
  SQLD_META_STORE_SECRET_ACCESS=your_secret_key \
  SQLD_META_STORE_REGION=auto \
  SQLD_META_STORE_BACKUP_ID=primary-cluster
```
