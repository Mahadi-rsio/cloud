# Cloud — Edge Application Hosting Platform

A serverless, multi-tenant cloud hosting platform that automatically discovers, builds, and deploys any web application or microservice from a GitHub repository (or Dockerfile) to [Fly.io](https://fly.io) Machines at the edge.

Built on **Next.js (Vinext on Cloudflare Workers)**, **Better Auth**, **Drizzle ORM + Neon PostgreSQL**, **BuildKit**, **Railpack**, and deterministic **Project Discovery** powered by `@vercel/frameworks` and `@vercel/fs-detectors`.

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
- **Real-Time Build Streaming**: Streams live build and deployment logs from the builder to the user dashboard using Server-Sent Events (SSE) with heartbeat and cursor resumption.
- **Edge Deployment**: Provisions user applications onto Fly.io Machines with automated free Anycast shared IPv4 routing (`https://<app>.fly.dev`).

---

## System Architecture

```mermaid
graph TD
  User([User / Browser]) <-->|HTTPS| Edge[Cloudflare Worker / Control Plane]

  subgraph CloudflareEdge[Control Plane - Cloudflare Worker]
    Edge --> Auth[Better Auth / Sessions]
    Edge --> Dash[Dashboard UI & Server Components]
    Edge --> API[REST API v1 /api/v1/*]
    Edge --> Rate[Upstash Redis Rate Limiting]
    Edge --> Q[(Cloudflare Queue: build-jobs)]
  end

  subgraph DataLayer[Data Layer]
    Auth <-->|neon-http| Neon[(Neon Serverless Postgres)]
    API <-->|Drizzle ORM| Neon
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
| **Styling & UI** | Tailwind CSS v4, Radix UI primitives, shadcn/ui, Lucide icons |
| **Client State & Cache** | TanStack Query v5, Zustand v5 |
| **Authentication** | [Better Auth](https://www.better-auth.com/) with email/password and session management |
| **Database & ORM** | Neon Serverless PostgreSQL with Drizzle ORM (`drizzle-orm/neon-http`, `drizzle-kit`) |
| **Queues & Rate Limiting** | Cloudflare Queues (`build-jobs`, `auth-jobs`), Upstash Redis |
| **Project Discovery** | `@vercel/frameworks`, `@vercel/fs-detectors`, custom deterministic polyglot scanners |
| **Image Builder** | Node 22, BuildKit v0.17+, Railpack v0.43+, FUSE overlayfs, Fly.io Machine |
| **Runtime Infrastructure** | Fly.io Machines API (Anycast shared IPv4, private 6PN mesh) |

---

## Project Directory Structure

```text
├── app/                          # Next.js App Router (pages and API routes)
│   ├── (app)/                    # Authenticated dashboard views (apps, deployments, settings)
│   ├── (auth)/                   # Authentication pages (login, register)
│   └── api/                      # Public & internal API routes (/api/v1/deployments, /api/auth)
├── builder/                      # Dedicated build worker service
│   ├── Dockerfile                # Builder container with BuildKit & Railpack
│   ├── entrypoint.sh             # BuildKit daemon launcher & overlay setup
│   └── server.mjs                # Builder HTTP server (/discover, /build, /health, /ready)
├── components/                   # React components
│   ├── apps/                     # Application creation and management UI
│   ├── deployments/              # Deployment detail, log terminal viewer
│   ├── shell/                    # Dashboard layout, sidebar, app bar
│   └── ui/                       # shadcn/ui design primitives
├── drizzle/                      # Database migration SQL files
│   ├── 0000_luxuriant_toad.sql
│   ├── 0001_add_applications_and_machines.sql
│   ├── 0002_add_deployments_and_deployment_logs.sql
│   └── 0003_acoustic_kate_bishop.sql
├── entrypoints/                  # Cloudflare Worker entrypoint and queue consumer
│   └── worker.ts
├── lib/                          # Core backend libraries
│   ├── auth/                     # Better Auth configuration
│   ├── build/                    # Build strategy, builder client, Railpack plan rewriting
│   ├── db/                       # Drizzle schema definitions (auth schema, product schema)
│   ├── fly/                      # Fly.io Machines API client
│   ├── project-discovery/        # Deterministic project discovery engine
│   └── validators/               # Zod validation schemas
├── tests/                        # Comprehensive test suite (93+ unit & integration tests)
├── cloudflare.config.ts          # Cloudflare Worker bindings and queue configurations
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
2. **[Cloudflare](https://cloudflare.com)** (Workers, Queues)
3. **[Fly.io](https://fly.io)** (Machines & OCI container registry)
4. **[Upstash](https://upstash.com)** (Redis for rate limiting)

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

# Redis Rate Limiting (Upstash)
UPSTASH_REDIS_REST_URL=https://sample.upstash.io
UPSTASH_REDIS_REST_TOKEN=upstash_token_here

# Optional GitHub Token (improves API rate limits for public repo inspection)
GITHUB_API_TOKEN=ghp_optional_token
```

---

### 4. Database Provisioning & Migrations

All tables are defined in [`lib/db/schema.ts`](file:///workspaces/cloud/lib/db/schema.ts) (Better Auth) and [`lib/db/product-schema.ts`](file:///workspaces/cloud/lib/db/product-schema.ts) (applications, machines, deployments, logs).

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
   pnpm dlx wrangler queues create auth-jobs
   pnpm dlx wrangler queues create build-jobs
   ```

3. **Set Worker Secrets**:
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
   pnpm dlx wrangler secret put UPSTASH_REDIS_REST_URL
   pnpm dlx wrangler secret put UPSTASH_REDIS_REST_TOKEN
   ```

4. **Build & Deploy**:
   ```bash
   pnpm build
   pnpm deploy
   ```

---

### 8. Testing & Verification

Run the comprehensive unit and integration test suite (16 suites, 93 tests):

```bash
node --experimental-transform-types --import ./tests/register.js --test tests/*.test.ts
```

Test coverage includes:
- **Project Discovery Engine**: Monorepo detection, path traversal prevention, framework detection (Next.js, Vite, Astro, SvelteKit, Django, FastAPI, Laravel, Go, Rust), and symlink escape validation.
- **Port Auto-Detection**: Parsing `/proc/net/tcp` socket tables, distinguishing `0.0.0.0` vs `127.0.0.1` listeners.
- **Railpack Plan Rewriter**: Idempotent builder plan rewriting and cache key injection.
- **Deployment State Machine**: Forward status transitions, cancellation, and retry semantics.
- **SSE Log Streaming**: Keyset pagination, chunk splitting, and event serialization.

---

## API Reference & Documentation Index

| Document | Purpose |
| --- | --- |
| [`api.md`](./api.md) | Full REST API specifications, request/response formats, error codes, and rate limits |
| [`architecture.md`](./architecture.md) | In-depth system architecture, reliability models, and runtime boundaries |
| [`builds.md`](./builds.md) | Build pipeline specifications, Railpack plan rewriting, and BuildKit daemon tuning |
| [`db.md`](./db.md) | Database schema documentation, table relationships, and index design |
| [`todo.md`](./todo.md) | Engineering roadmap, MVP milestones, and operational checklist |

---

## License

Private repository. Copyright © 2026 Mahadi-rsio / Cloud. All rights reserved.
