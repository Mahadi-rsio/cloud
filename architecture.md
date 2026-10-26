# Architecture — Cloud Hosting Platform

> **Status:** This document separates the **current** architecture (verified in source at commit `d6265a6`) from the **proposed target** architecture. Every proposed component is explicitly labeled.
> **Related documents:** [`prd.md`](./prd.md), [`api.md`](./api.md), [`db.md`](./db.md), [`plan.md`](./plan.md), [`todo.md`](./todo.md)

## 1. Current Architecture

### 1.1 Major components (implemented)

| Component | Implementation | Role |
| --- | --- | --- |
| Next.js app (vinext) | `app/**`, `components/**`, `stores/**` | Server-rendered dashboard UI; server components call `getSession()` |
| Better Auth | `lib/auth/index.ts`, `app/api/auth/[...all]/route.ts` | Email/password auth, sessions, user management |
| Drizzle ORM + Neon Postgres | `lib/db/index.ts`, `lib/db/schema.ts` | Authoritative store for users/accounts (Better Auth tables only) |
| Cloudflare KV | `lib/auth/storage/kv.ts` (binding `AUTH_KV`) | Better Auth secondary storage (sessions/tokens); in-memory fallback outside Workers |
| Cloudflare Queue | `cloudflare.config.ts` (binding `AUTH_JOBS`, name `auth-jobs`), `lib/queue.ts`, `entrypoints/worker.ts` | Async welcome-email job |
| Cloudflare Worker | `entrypoints/worker.ts`, `cloudflare.config.ts`, `vite.config.ts` | Hosts the app; queue consumer; `nodejs_compat` |
| shadcn/ui + radix-ui + Tailwind v4 | `components/ui/*`, `components/shell/*`, `components.json` | UI primitives and shell |
| TanStack Query | `components/auth/login-form.tsx`, `components/settings/settings-form.tsx` | Client mutations for auth forms |
| Zustand | `stores/*` | Client-side UI state (auth form, shell, theme) |
| Axios client | `lib/api.ts` | Typed-lite HTTP client for `/api/auth` |

### 1.2 Current architecture diagram

```mermaid
graph TD
  U[User Browser] -->|HTTPS| W[Cloudflare Worker (vinext)]
  subgraph CF[Cloudflare edge]
    W --> AUTH[Better Auth handler<br/>app/api/auth/*]
    W --> SSR[Server-rendered pages<br/>app/(app)/*]
    AUTH --> KV[(AUTH_KV<br/>KV secondary storage)]
    AUTH --> PG[(Neon Postgres<br/>user + account)]
    AUTH --> Q[(auth-jobs Queue)]
    Q --> WQ[queue consumer<br/>entrypoints/worker.ts]
  end
  SSR -->|getSession| AUTH
```

### 1.3 Data flow boundaries (current)

- The browser talks only to the Worker.
- Auth reads/writes Postgres through Drizzle (neon-http driver, `fetchConnectionCache = true`).
- KV is a **secondary** store for Better Auth; the DB remains authoritative for user/account data.
- The queue is used only for `welcome-email`; the consumer currently logs the job body.

### 1.4 Reliability properties (current)

- Session caching: `getAuth()`/`getDb()`/`getEnv()` use process-level singletons.
- Queue: no explicit retry/DLQ configuration is set in code; behavior is Cloudflare Queue defaults. No idempotency is implemented.

## 2. Proposed Target Architecture

### 2.1 Responsibilities split

- **Control plane** (this repo, deployed as a Cloudflare Worker): auth, dashboard, API, plans, subscriptions, payments, backups metadata, audit.
- **Runtime plane** (Fly.io): Fly Machines and Volumes. Managed exclusively by the control plane backend through the Fly Machines API using a server-side token. [Proposed]
- **Backup/storage plane** (Cloudflare R2): backup objects and artifacts. [Proposed]

### 2.2 Target architecture diagram

```mermaid
graph TD
  U[User Browser] -->|HTTPS| W[Cloudflare Worker (vinext)]
  subgraph CF[Cloudflare edge]
    W --> AUTH[Better Auth]
    W --> API[/api/v1/* controllers]
    W --> SSR[Server-rendered pages]
    AUTH --> KV[(AUTH_KV)]
    API --> PG[(Neon Postgres<br/>authoritative metadata)]
    API --> OUTBOX[(transactional outbox<br/>operations)]
    OUTBOX -->|publish| Q[(job Queues)]
    Q --> WQ[queue workers<br/>provision/lifecycle/backup]
    WQ --> PG
    WQ --> FLY[Fly Machines API<br/>machines + volumes]
    WQ --> R2[(R2 backups)]
    API --> FLY
    API --> R2
    WQ --> KV2[(KV cache: regions, plans, status)]
  end
```

- Legend: `PG` and `OUTBOX` are proposed tables in Neon; `FLY`, `R2`, `KV2`, and the job queues are proposed integrations.

### 2.3 Authentication and authorization flow (proposed)

1. `getSession()` validates the Better Auth cookie (DB + KV secondary storage).
2. API middleware injects `session.user`.
3. Resource handlers verify ownership (`app.userId === session.user.id`) before any DB or Fly call.
4. Sensitive operations write an audit event.

### 2.4 Application provisioning sequence (proposed)

1. `POST /api/v1/applications` validates body, enforces quota (DB transaction), creates `applications` row in `pending`.
2. Outbox row inserted; queue message published.
3. Worker: create Fly Machine via Fly API, store `fly_machine_id`, transition to `running`, emit audit event.
4. On failure: retry with backoff, then mark `failed` and record error.

### 2.5 Lifecycle flows (proposed)

- **Start/stop/restart/redeploy:** same outbox pattern; idempotency keyed per operation.
- **Update:** `PATCH` applies safe fields only (name, runtime, region) with a 409 guard if an operation is pending.
- **Delete:** mark `deleting` → worker stops machine, destroys volumes, archives rows → `deleted`.

### 2.6 Payment and subscription lifecycle (proposed)

1. User initiates bKash payment with an idempotency key stored in Postgres.
2. bKash callback records raw event; never finalizes state from the body.
3. A server-side verification call to bKash reconciles status; on success the subscription activates inside a DB transaction.
4. Scheduled reconciliation resyncs `subscriptions` with provider state.

### 2.7 Queue processing (proposed)

- Queues: `provisioning`, `lifecycle`, `backups` (or one queue with typed jobs like `AuthJob`).
- Consumers tolerate duplicate delivery via unique `idempotency_key` on `outbox`/`operations` rows.
- Retry/backoff per queue; failed jobs go to a dead-letter queue with alerting.

### 2.8 Backup and restore (proposed)

1. Backup job snapshots eligible data (e.g., volume snapshot or DB dump) and writes encrypted objects to R2.
2. `backups` rows record object key, size, checksum, retention window.
3. Restore downloads, verifies checksum, applies to the target machine, and runs validation before marking success.

### 2.9 Cache design (proposed)

- KV caches only non-authoritative, easily-regenerable data: region lists, plan catalog, status summaries.
- Never KV-only for payment/subscription/quota enforcement.
- Invalidation: version keys (`plans:v3`) and short TTLs; authoritative reads always hit Postgres.

### 2.10 Rate limiting and abuse prevention (proposed)

- Per-user token-bucket on create/start/stop/backup/payment endpoints; global caps on unauthenticated auth endpoints.
- Idempotency keys prevent double-charge and double-provision.

### 2.11 Observability (proposed)

- Structured logs on worker and queue consumer; audit events table for sensitive actions; health endpoint; error telemetry.

### 2.12 Secrets (current + proposed)

- Current secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (Worker secret bindings in `cloudflare.config.ts`).
- Proposed additions: `FLY_API_TOKEN` (least-privilege), `R2_*` credentials, `BKASH_*` merchant keys. Rotate via Worker secret rotation.

### 2.13 Deployment environments and migration (proposed)

- Local (`next dev`, in-memory KV fallback) / preview (`CLOUDFLARE_PREVIEW_BUILD=true`, no queue trigger) / production.
- DB migrations applied via Drizzle Kit with backward-compatible, incremental migrations.

### 2.14 Reliability and disaster recovery (proposed)

- Reconciliation jobs resync Fly machine state and bKash subscriptions from source-of-truth.
- R2 object retention + periodic restore drills.

### 2.15 Cost control and multi-tenant isolation (proposed)

- Quota enforcement inside transactions; per-app resource limits mapped from plan entitlements; strict ownership checks preventing cross-tenant access.
