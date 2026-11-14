# Cloud — Edge Application Hosting Platform

A serverless, multi-tenant cloud hosting platform that automatically discovers, builds, and deploys any web application or microservice from a GitHub repository (or Dockerfile) to [Fly.io](https://fly.io) Machines at the edge.

Built on **Next.js (Vinext on Cloudflare Workers)**, **Better Auth** (with API key plugin), **Drizzle ORM + Neon PostgreSQL**, **Cloudflare R2**, **BuildKit**, **Railpack**, and deterministic **Project Discovery** powered by `@vercel/frameworks` and `@vercel/fs-detectors`.

---

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Project Directory Structure](#project-directory-structure)
- [Comprehensive Setup & Run Guide](#comprehensive-setup--run-guide)
  - [1. Prerequisites](#1-prerequisites)
  - [2. Clone & Install Dependencies](#2-clone--install-dependencies)
  - [3. Environment Configuration](#3-environment-configuration)
  - [4. Database Provisioning & Migrations](#4-database-provisioning--migrations)
  - [5. Running the Control Plane Locally](#5-running-the-control-plane-locally)
  - [6. Deploying the Builder Machine to Fly.io](#6-deploying-the-builder-machine-to-flyio)
  - [7. Deploying the Control Plane to Cloudflare Workers](#7-deploying-the-control-plane-to-cloudflare-workers)
  - [8. Testing & Verification](#8-testing--verification)
- [API Reference & Documentation Index](#api-reference--documentation-index)
- [License](#license)

---

## Core Capabilities

- **Automatic Project & Framework Discovery**: Deterministically analyzes any GitHub repository or monorepo to identify frameworks (Next.js, Vite, Remix, Astro, SvelteKit, Django, FastAPI, Go, Rust, Rails, Phoenix, Laravel, etc.), package managers, runtimes, and nested application roots without executing untrusted code.
- **Monorepo & Workspace Support**: Discovers independently deployable apps inside pnpm workspaces, npm/Yarn workspaces, Turborepo, Nx, Cargo, and Go workspaces while filtering out shared UI/config packages.
- **Smart Dual-Engine Build Pipeline**:
  - Builds repositories with existing `Dockerfile`s via rootless BuildKit.
  - Automatically plans and compiles zero-config repositories using **Railpack**.
  - Falls back gracefully to Railpack if a repository's Dockerfile fails (e.g. CI-only Dockerfiles).
- **Dynamic Port Detection**: Sniffs `/proc/net/tcp` and `/proc/net/tcp6` in deployed containers to verify listening ports bind to `0.0.0.0` (not loopback `127.0.0.1`) and automatically routes public HTTP (80) and HTTPS (443) traffic.
- **Multi-Tenant Database Service**: Managed multi-tenant libSQL (`sqld`) service providing instant, sub-millisecond per-tenant SQLite database isolation, copy-on-write branching, and stateless Ed25519 cryptographic token authentication.
- **Real-Time Build Streaming**: Streams live build and deployment logs from the builder to the user dashboard using Server-Sent Events (SSE) with heartbeat and cursor resumption.
- **Edge Deployment**: Provisions user applications onto Fly.io Machines with automated free Anycast shared IPv4 routing (`https://<app>.fly.dev`).
- **Object Storage Service & Web UI**: High-performance, multi-tenant file storage backed by Cloudflare R2, Neon PostgreSQL, Cloudflare Hyperdrive, and Cloudflare Durable Objects. Features an interactive web dashboard (`/storage`) for creating storage namespaces, drag-and-drop file uploads, browser downloads, file deletion, metadata & image previews, and API key management with secret key reveal. Includes versioned REST APIs, SQLite-backed Durable Object quota and metering (512 MB free capacity, 100k Class A write ops, 100k Class B read ops), two-tier L1 memory + Cloudflare KV L2 key caching, Durable Object SQLite outbox batching to reduce database writes, HMAC presigned tokens, file copy operations, conditional requests (`If-None-Match`/`If-Modified-Since`), 100 MB upload limits, XSS hardening, and OpenAPI 3.1 specification.

---

## System Architecture

```mermaid
graph TD
  User([User / Browser]) <-->|HTTPS| Edge[Cloudflare Worker / Control Plane]

  subgraph CloudflareEdge[Control Plane - Cloudflare Worker]
    Edge --> Auth[Better Auth / CookieCache]
    Edge --> Dash[Dashboard UI & Server Components]
    Edge --> API[REST API v1 /api/v1/*]
    Edge --> StorageAPI[Storage API /api/v1/storage/*]
    Edge --> Rate[Cloudflare Workers Rate Limiting]
    Edge --> Q[(Cloudflare Queue: build-jobs)]
    StorageAPI --> StorageAuth[Tiered Auth Cache\nL1 Memory + L2 APP_KV]
    StorageAPI --> MeterDO[TenantMeterDO\nAtomic Quota & SQLite Outbox]
    StorageAPI --> R2[(cloud-storage R2 Bucket)]
    Edge --> StreamDO[DeploymentStreamDO\nLive SSE State]
  end

  subgraph DataLayer[Data Layer]
    Auth <-->|Hyperdrive Pool| Neon[(Neon Serverless Postgres\nauth + product + storage_* tables)]
    API <-->|Hyperdrive Pool| Neon
    StorageAuth -.->|Cache Miss Only| Neon
    MeterDO -.->|Async Outbox Batch Flush| Neon
  end

  subgraph FlyPlatform[Fly.io Infrastructure]
    Q -->|Job Consumer| BldCtrl[Builder Controller]
    BldCtrl -->|POST /build| Builder[Fly Builder Machine cloud-builder]
    API -->|POST /discover| Builder
    Builder -->|Railpack & BuildKit| BuildKit[BuildKit Daemon]
    BuildKit -->|Push OCI Image| Reg[(Fly OCI Registry)]
    Builder -->|Complete Callback| API
    API -->|Machines API| UserApp[Customer Fly Machine App]
    Reg -->|Pull Image| UserApp
  end
```

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Control Plane** | Next.js 16 (React 19), [Vinext](https://github.com/cloudflare/vinext) on Cloudflare Workers, TypeScript |
| **Styling & UI** | Material UI (MUI v9) with Emotion, Lucide icons |
| **Client State & Cache** | TanStack Query v5, Zustand v5 |
| **Authentication** | [Better Auth](https://www.better-auth.com/) with email/password, session management, 5-minute cookie caching, and `@better-auth/api-key` plugin |
| **Object Storage** | Cloudflare R2 (`cloud-storage` bucket) for multi-tenant file storage; control-plane metadata in Neon (`storage_*` tables) |
| **Control Plane Database** | Neon Serverless PostgreSQL with Drizzle ORM via **Cloudflare Hyperdrive** connection pooling (`drizzle-orm/node-postgres`, `pg.Pool` request-scoped via `withDbScope`); direct `DATABASE_URL` fallback for dev & migrations |
| **Global Read Cache** | Cloudflare Workers KV (`APP_KV`) with typed abstraction (`TypedKvCache`) and isolate memory L1 cache |
| **Atomic Quota & Metering** | Cloudflare Durable Objects (`TenantMeterDO` with SQLite storage) providing atomic reservation, quota enforcement, and asynchronous SQLite outbox persistence |
| **Real-Time Log Streaming** | Cloudflare Durable Objects (`DeploymentStreamDO`) coordinating live SSE broadcast and subscriber fan-out without database polling |
| **Tenant Database Service** | Multi-tenant SQLite/libSQL Server (`sqld` in namespace mode) on Fly.io with `/databases` dashboard & `/admin/db` Studio UI |
| **Queues & Rate Limiting** | Cloudflare Queues (`build-jobs`), native **Cloudflare Workers Rate Limiting** (`RL_API_*`, `RL_STORAGE_*`, `RL_STUDIO`) |
| **Project Discovery** | `@vercel/frameworks`, `@vercel/fs-detectors`, custom deterministic polyglot scanners |
| **Image Builder** | Node 22, BuildKit v0.17+, Railpack v0.43+, FUSE overlayfs, Fly.io Machine |
| **Runtime Infrastructure** | Fly.io Machines API (Anycast shared IPv4, private 6PN mesh) |

---

## Project Directory Structure

```text
├── app/                          # Next.js App Router (pages and API routes)
│   ├── (app)/                    # Authenticated dashboard views (apps, databases, deployments, storage, settings)
│   ├── (auth)/                   # Authentication page (login / sign-up)
│   ├── admin/db/                 # Embedded SQLite/libSQL Studio UI
│   └── api/                      # Public & internal API routes (/api/v1/*, /api/auth, /api/databases, /api/studio)
├── builder/                      # Dedicated build worker service
│   ├── Dockerfile                # Builder container with BuildKit & Railpack
│   ├── entrypoint.sh             # BuildKit daemon launcher & overlay setup
│   └── server.mjs                # Builder HTTP server (/discover, /build, /health, /ready)
├── components/                   # React components
│   ├── apps/                     # Application creation and management UI
│   ├── databases/                # SQLite/libSQL database provisioning and connection UI
│   ├── deployments/              # Deployment detail, log terminal viewer
│   ├── settings/                 # User account settings UI
│   ├── shared/                   # Shared MUI display and feedback components
│   ├── shell/                    # Dashboard layout, sidebar, app bar
│   ├── storage/                  # Object storage explorer, uploads, API key management
│   ├── studio/                   # SQLite/libSQL Studio data grid & SQL editor
│   └── theme/                    # Light/dark theme toggle & MUI theme provider
├── databases/                    # Multi-tenant libSQL (sqld) database service
│   ├── fly.toml                  # Dual-port Fly.io manifest (Data 443, Admin 8443)
│   ├── manage.js                 # Zero-dependency tenant lifecycle & token CLI
│   ├── docker-compose.yml        # Local multi-tenant development environment
│   └── examples/                 # Polyglot ORM examples (Node, Drizzle, Kysely, Python, Go)
├── drizzle/                      # Database migration SQL files (0000–0009)
│   ├── 0000_luxuriant_toad.sql
│   ├── 0001_add_applications_and_machines.sql
│   ├── 0002_add_deployments_and_deployment_logs.sql
│   ├── 0003_acoustic_kate_bishop.sql
│   ├── 0004_open_prism.sql        # Better Auth apikey table
│   ├── 0005_brief_trish_tilby.sql # Storage control-plane tables (storage_*)
│   ├── 0006_dazzling_jubilee.sql
│   ├── 0007_add_databases_table.sql
│   ├── 0008_right_silver_fox.sql
│   └── 0009_freezing_moondragon.sql
├── entrypoints/                  # Cloudflare Worker entrypoint and queue consumer
│   └── worker.ts
├── lib/                          # Core backend libraries
│   ├── auth/                     # Better Auth configuration (+ apiKey plugin)
│   ├── build/                    # Build strategy, builder client, Railpack plan rewriting
│   ├── databases/                # Multi-tenant libSQL control-plane & tenant clients
│   ├── db/                       # Drizzle schema definitions (auth, product, storage schemas)
│   ├── fly/                      # Fly.io Machines API client
│   ├── project-discovery/        # Deterministic project discovery engine
│   ├── storage/                  # Multi-tenant object storage service
│   │   ├── schema.ts             #   Drizzle schema for storage_* tables (Neon)
│   │   ├── db.ts                 #   Storage DB helpers (reuses Neon via getDb())
│   │   ├── service.ts            #   Business logic: tenant, namespace, file operations, copy
│   │   ├── request-auth.ts       #   Auth middleware: verifyApiKey → tenantId with L1 memory + L2 KV cache
│   │   ├── presign.ts            #   HMAC-SHA256 presigned token generation & verification
│   │   ├── rate-limit-headers.ts #   Standard rate-limit response headers helper (Workers Rate Limiting)
│   │   └── validators.ts         #   Zod schemas for storage API requests
│   └── validators/               # Zod validation schemas
├── tests/                        # Vitest unit & integration test suites (14 files)
├── cloudflare.config.ts          # Cloudflare Worker bindings, Hyperdrive, KV, Rate Limiting, & queues
├── drizzle.config.ts             # Drizzle Kit configuration
└── fly.toml                      # Fly.io builder machine deployment manifest
```

---

## Comprehensive Setup & Run Guide

### 1. Prerequisites

Ensure you have the following installed locally:
- **Node.js**: `v22.x` or later
- **pnpm**: `v9.x` or later (`npm install -g pnpm`)
- **Fly CLI**: `flyctl` ([Installation guide](https://fly.io/docs/hands-on/install-flyctl/))
- **Docker**: For running or building the builder container locally (optional for control plane only)

You will need accounts on:
1. **[Neon](https://neon.tech)** (PostgreSQL database)
2. **[Cloudflare](https://cloudflare.com)** (Workers, Hyperdrive, KV, Queues, R2)
3. **[Fly.io](https://fly.io)** (Machines & OCI container registry)

---

### 2. Clone & Install Dependencies

```bash
git clone https://github.com/Mahadi-rsio/cloud.git
cd cloud
pnpm install
```

---

### 3. Environment Configuration

Create `.dev.vars` in the repository root for local development:

```bash
cp .env.example .dev.vars
```

Fill in your configuration variables in `.dev.vars`:

```env
# Database (Neon Serverless PostgreSQL connection string)
DATABASE_URL=postgresql://user:password@ep-sample-pooler.region.neon.tech/neondb?sslmode=require

# Authentication
BETTER_AUTH_SECRET=your-32-character-random-secret
BETTER_AUTH_URL=http://localhost:3000

# Public domain for deployed applications
NEXT_PUBLIC_APP_DOMAIN=fly.dev

# Fly.io API Credentials
FLY_API_TOKEN=fly_api_token_here
FLY_ORG_SLUG=personal
FLY_DEFAULT_REGION=sin
FLY_DEFAULT_IMAGE=nginx:alpine

# Shared Builder Machine Configuration
BUILDER_URL=https://cloud-builder.fly.dev
BUILDER_API_TOKEN=generate-a-secure-builder-token
BUILDER_APP_NAME=cloud-builder
BUILDER_MACHINE_ID=your-fly-builder-machine-id

# Builder -> Control Plane Callbacks
INTERNAL_API_TOKEN=generate-a-secure-internal-token
CONTROL_PLANE_URL=http://localhost:3000

# OCI Registry for Build Images (Fly.io registry)
OCI_REGISTRY=registry.fly.io
OCI_REGISTRY_USERNAME=x
OCI_REGISTRY_PASSWORD=fly_api_token_here

# Optional GitHub Token (improves API rate limits for public repo inspection)
GITHUB_API_TOKEN=ghp_optional_token
```

---

### 4. Database Provisioning & Migrations

All tables are defined in [`lib/db/schema.ts`](file:///workspaces/cloud/lib/db/schema.ts) (Better Auth — `user`, `account`, `apikey`), [`lib/db/product-schema.ts`](file:///workspaces/cloud/lib/db/product-schema.ts) (applications, machines, deployments, deployment logs, databases), and [`lib/storage/schema.ts`](file:///workspaces/cloud/lib/storage/schema.ts) (storage control-plane: `storage_tenants`, `storage_projects`, `storage_api_keys`, `storage_usage_daily`, `storage_usage_events`, `storage_audit_log`).

Run migrations to sync your Neon PostgreSQL database:

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .dev.vars | cut -d= -f2-)" npx drizzle-kit migrate
```

To generate a new migration after modifying schema definitions:

```bash
npx drizzle-kit generate
```

To open Drizzle Studio for visual database inspection:

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .dev.vars | cut -d= -f2-)" npx drizzle-kit studio
```

---

### 5. Running the Control Plane Locally

Start the Vinext local development server:

```bash
pnpm dev
```

The control plane dashboard will be available at:
`http://localhost:3000`

---

### 6. Deploying the Builder Machine to Fly.io

The builder runs as an isolated machine on Fly.io running BuildKit daemon and Railpack.

1. **Authenticate with Fly**:
   ```bash
   fly auth login
   ```

2. **Create the builder application & volume**:
   ```bash
   fly apps create cloud-builder
   # Create persistent cache volume for BuildKit
   fly volumes create buildkit_cache --region lax --size 50 -a cloud-builder
   ```

3. **Set builder secrets**:
   ```bash
   fly secrets set \
     BUILDER_API_TOKEN="your-builder-api-token" \
     INTERNAL_API_TOKEN="your-internal-api-token" \
     CONTROL_PLANE_URL="https://your-domain.workers.dev" \
     OCI_REGISTRY="registry.fly.io" \
     OCI_REGISTRY_USERNAME="x" \
     OCI_REGISTRY_PASSWORD="$(fly auth token)" \
     -a cloud-builder
   ```

4. **Deploy the builder**:
   ```bash
   TOKEN=$(fly auth token 2>/dev/null) && FLY_API_TOKEN="$TOKEN" fly deploy --ha=false
   ```

5. **Verify builder health**:
   ```bash
   curl -i https://cloud-builder.fly.dev/health
   # Returns: {"ok":true,"busy":false,"queued":0,"uptimeSeconds":...}
   ```

---

### 7. Deploying the Control Plane to Cloudflare Workers

The control plane deploys as a Cloudflare Worker using [`@vinext/cloudflare`](https://github.com/cloudflare/vinext).

1. **Authenticate with Cloudflare**:
   ```bash
   pnpm dlx wrangler login
   ```

2. **Create Cloudflare Queues**:
   ```bash
   pnpm dlx wrangler queues create build-jobs
   ```

3. **Create the R2 storage bucket**:
   ```bash
   pnpm dlx wrangler r2 bucket create cloud-storage
   ```

4. **Set Worker Secrets**:
   Upload the secrets from `.dev.vars` to Cloudflare:
   ```bash
   pnpm dlx wrangler secret put DATABASE_URL
   pnpm dlx wrangler secret put BETTER_AUTH_SECRET
   pnpm dlx wrangler secret put BETTER_AUTH_URL
   pnpm dlx wrangler secret put FLY_API_TOKEN
   pnpm dlx wrangler secret put BUILDER_URL
   pnpm dlx wrangler secret put BUILDER_API_TOKEN
   pnpm dlx wrangler secret put BUILDER_APP_NAME
   pnpm dlx wrangler secret put BUILDER_MACHINE_ID
   pnpm dlx wrangler secret put INTERNAL_API_TOKEN
   pnpm dlx wrangler secret put CONTROL_PLANE_URL
   pnpm dlx wrangler secret put OCI_REGISTRY
   pnpm dlx wrangler secret put OCI_REGISTRY_USERNAME
   pnpm dlx wrangler secret put OCI_REGISTRY_PASSWORD
   ```

5. **Build & Deploy**:
   ```bash
   pnpm build
   pnpm run deploy
   ```

---

### 8. Testing & Verification

Run the Vitest unit and integration test suite:

```bash
pnpm test
```

Test coverage includes:
- **Project Discovery Engine**: Monorepo detection, path traversal prevention, framework detection (Next.js, Vite, Astro, SvelteKit, Django, FastAPI, Laravel, Go, Rust), and symlink escape validation.
- **Port Auto-Detection**: Parsing `/proc/net/tcp` socket tables, distinguishing `0.0.0.0` vs `127.0.0.1` listeners.
- **Railpack Plan Rewriter**: Idempotent builder plan rewriting and cache key injection.
- **Deployment State Machine**: Forward status transitions, cancellation, and retry semantics.
- **SSE Log Streaming**: Keyset pagination, chunk splitting, and event serialization.
- **Storage Phase 2 Data Plane**: Path traversal prevention, deterministic tenant key layout, HMAC presigned token lifecycle, upload/download/head/copy operations via in-memory bucket abstraction.

---

## Infrastructure Optimization & Benchmarks (Verified Live Metrics)

The production infrastructure was refactored to eliminate third-party Redis dependencies (Upstash), minimize Neon PostgreSQL query load, and leverage Cloudflare-native primitives:

### Technology Allocation

| Responsibility | Technology | Implementation |
| --- | --- | --- |
| **Primary Database** | Neon Serverless PostgreSQL | `lib/db/index.ts`, `lib/db/schema.ts` |
| **Database Acceleration** | Cloudflare Hyperdrive | `HYPERDRIVE` binding (`cloud-prod-hyperdrive`), request-scoped `pg.Pool` via `withDbScope` (AsyncLocalStorage) |
| **Global Read Cache** | Cloudflare Workers KV | `APP_KV` binding, typed abstraction `TypedKvCache` in `lib/kv.ts` |
| **Local Hot Cache** | Worker Isolate Memory | Bounded LRU/Map caches (`MEMORY_KEY_CACHE`, 30s TTL) |
| **Approximate Rate Limiting** | Cloudflare Workers Rate Limiting | Native `RL_*` bindings (`RL_API_FREE`, `RL_API_PRO`, `RL_STORAGE_*`, `RL_STUDIO`) replacing Upstash Redis |
| **Atomic Quotas & Outbox** | Cloudflare Durable Objects | `TenantMeterDO` (SQLite storage) for concurrent quota checks and outbox batching |
| **Live Log Streaming** | Cloudflare Durable Objects | `DeploymentStreamDO` coordinating live SSE broadcast without polling Neon |
| **Object Storage** | Cloudflare R2 | `STORAGE_BUCKET` (`cloud-storage`) |
| **Authentication** | Better Auth | Authoritative Neon tables, 5-minute cookie cache (`cookieCache`) |

### Verified Live Benchmark (`https://cloud.rsioex.workers.dev`)

Measured live against the production Cloudflare Worker and audited directly with PostgreSQL `pg_stat_statements` (filtering out internal server/replication queries):

| Live Workload | Volume | Measured Neon Queries | Neon Queries / Req | Latency p50 | Latency p95 |
| --- | --- | --- | --- | --- | --- |
| **Storage GET (API key auth)** | 200 reqs | 2 queries *(initial key + tenant)* | **0.01** | 348 ms | 388 ms |
| **Storage PUT (API key auth)** | 40 reqs | 0 queries *(cached + DO outbox)* | **0.00** | 572 ms | 645 ms |
| **`GET /api/auth/get-session`** | 100 reqs | 2 queries *(initial session + user)* | **0.02** | 23 ms | 37 ms |
| **`GET /api/v1/deployments`** | 50 reqs | 50 queries *(authoritative fetch)* | **1.00** | 105 ms | 124 ms |

### Architectural Efficiency Gains

1. **Storage Read Hot Paths**:
   - **Before**: ~6 DB operations per request (repeated API key verification, tenant lookup, lastUsedAt update).
   - **After**: ~0.01 DB queries per request (initial lookup cached in L1 memory for 30s and L2 KV for 60s with cryptographic SHA-256 key hashes and instant revocation tombstones). **>99% reduction in database hits.**
2. **Usage Event Recording**:
   - **Before**: Synchronous multi-query usage writes on every upload/download/delete hot path.
   - **After**: TenantMeterDO SQLite Outbox reserves atomic quotas instantly and batches usage events into Neon (`INSERT ... ON CONFLICT (event_id) DO NOTHING` and `INSERT ... ON CONFLICT DO UPDATE` daily aggregation), reducing 1,800 transactional writes to 4 batch queries.
3. **SSE Deployment Logs**:
   - **Before**: Polling Neon PostgreSQL every 3 seconds per connected browser subscriber.
   - **After**: `DeploymentStreamDO` coordinates live subscribers in Durable Object memory, pushing logs directly to SSE streams and persisting logs durably upon build completion.
4. **Hyperdrive Request Scoping**:
   - Hyperdrive connection pooling manages TCP sockets to Neon efficiently. Connection pools are request-scoped using Node's `AsyncLocalStorage` (`withDbScope`) inside `entrypoints/worker.ts`, strictly respecting Cloudflare Worker 6-outbound-socket limits and I/O context lifetimes.

---

## API Reference & Documentation Index

| Document | Purpose |
| --- | --- |
| [`api.md`](./api.md) | Full REST API specifications, request/response formats, error codes, and rate limits (includes Storage API §3.11) |
| [`architecture.md`](./architecture.md) | In-depth system architecture, reliability models, and runtime boundaries |
| [`builds.md`](./builds.md) | Build pipeline specifications, Railpack plan rewriting, and BuildKit daemon tuning |
| [`db.md`](./db.md) | Database schema documentation, table relationships, and index design (includes storage and apikey tables §1.5–§1.6) |
| [`databases/README.md`](./databases/README.md) | Multi-tenant libSQL service, Admin API (port 8443), and Ed25519 token authentication |
| [`todo.md`](./todo.md) | Engineering roadmap, MVP milestones, and operational checklist |

---

## License

Private repository. Copyright © 2026 Mahadi-rsio / Cloud. All rights reserved.
