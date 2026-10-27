# Database Design and Optimization — Cloud Hosting Platform

> **Status:** This document first describes the **existing** schema (verified), then the **proposed** normalized target schema, then optimization guidance. Proposed tables are labeled.
> **Related documents:** [`prd.md`](./prd.md), [`api.md`](./api.md), [`architecture.md`](./architecture.md), [`plan.md`](./plan.md), [`todo.md`](./todo.md)

## 1. Existing Schema (verified)

Source: `lib/db/schema.ts`, migration `drizzle/0000_luxuriant_toad.sql`; product tables: `lib/db/product-schema.ts`, migration `drizzle/0001_add_applications_and_machines.sql`.

### 1.1 Tables

**`user`** — Better Auth managed.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | text | PK |
| `name` | text | not null |
| `email` | text | not null, unique |
| `email_verified` | boolean | not null, default false |
| `image` | text | nullable |
| `created_at` / `updated_at` | timestamp | not null |

**`account`** — Better Auth managed (OAuth + email/password credential accounts).

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | text | PK |
| `account_id` | text | not null |
| `provider_id` | text | not null |
| `user_id` | text | not null, FK → `user.id` ON DELETE CASCADE |
| `access_token`, `refresh_token`, `id_token` | text | nullable |
| `access_token_expires_at`, `refresh_token_expires_at` | timestamp | nullable |
| `scope` | text | nullable |
| `password` | text | nullable (hash for email/password accounts) |
| `created_at` / `updated_at` | timestamp | not null |

Index: `account_userId_idx` on `account(user_id)`.

### 1.2 Gaps vs target design

- Auth tables plus `applications` and `machines` exist (migration `0001_add_applications_and_machines.sql`).
- Still missing: plans, subscriptions, payments, volumes, backups, operations, usage, idempotency, outbox, and audit tables.
- No RLS; ownership must be enforced in the application layer (already the model used by Better Auth).
- Lifecycle check constraints exist on `applications.status` and `machines.status`.

### 1.3 Product tables (implemented)

Source: `lib/db/product-schema.ts`; migration `drizzle/0001_add_applications_and_machines.sql`.

**`applications`** — user-owned application and desired state.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | uuid | PK, default random |
| `user_id` | text | not null, FK → `user.id` ON DELETE CASCADE |
| `name` | text | not null |
| `slug` | text | not null, unique |
| `status` | text | not null, default `pending`; check `pending|provisioning|running|failed|deleting|deleted` |
| `region` | text | not null |
| `runtime` | jsonb | nullable |
| `requested_resources` | jsonb | nullable |
| `last_operation_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | not null |
| `deleted_at` | timestamptz | nullable (soft delete) |

Indexes: `applications_user_status_idx` on `(user_id, status)`, `applications_user_updated_idx` on `(user_id, updated_at)`.

**`machines`** — Fly Machine records belonging to an application.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | uuid | PK, default random |
| `application_id` | uuid | not null, FK → `applications.id` ON DELETE CASCADE |
| `fly_machine_id` | text | unique, nullable |
| `status` | text | not null, default `provisioning`; check `provisioning|running|stopped|stopping|starting|restarting|redeploying|failed|destroying|destroyed` |
| `region` | text | not null |
| `instance_number` | integer | not null, default 0 |
| `shared_ipv4` / `shared_ipv6` | text | nullable |
| `public_url` | text | nullable |
| `allocated_resources` | jsonb | nullable |
| `error` | jsonb | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

Indexes: unique partial `machines_application_id_active_idx` on `(application_id)` where `status <> 'destroyed'`.

**Note:** the target schema in §2.1–§2.2 remains the design goal; the implemented tables omit `plan_id`, `subscription_id`, volumes, operations, and the rest of the normalized model.

### 1.4 Deployment tables (implemented)

Source: `lib/db/product-schema.ts`; migration `drizzle/0002_add_deployments_and_deployment_logs.sql`.

**`deployments`** — a GitHub-repository deployment (build + deploy run).

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | uuid | PK, default random |
| `user_id` | text | not null, FK → `user.id` ON DELETE CASCADE |
| `repo_url` | text | not null |
| `repo_owner` / `repo_name` | text | not null |
| `branch` | text | not null |
| `commit_sha` | text | nullable (resolved head before a build) |
| `status` | text | not null, default `queued`; check `queued|preparing|building|pushing|deploying|active|failed|cancelled` |
| `error_message` | text | nullable |
| `image_ref` | text | nullable (OCI image reference of the last pushed build) |
| `fly_app_id` / `fly_machine_id` | text | nullable |
| `public_url` | text | nullable |
| `build_number` | integer | not null, default 1; incremented on each retry |
| `started_at` / `finished_at` | timestamptz | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

Indexes: `deployments_user_created_idx` on `(user_id, created_at)`, unique partial `deployments_fly_app_id_active_idx` on `(fly_app_id)` where `fly_app_id is not null`.

**`deployment_logs`** — append-only build output for a deployment.

| Column | Type | Constraints |
| --- | --- | --- |
| `id` | bigserial | PK (number mode; JSON-safe for API responses) |
| `deployment_id` | uuid | not null, FK → `deployments.id` ON DELETE CASCADE |
| `stream` | text | not null; check `stdout|stderr|system` |
| `message` | text | not null |
| `created_at` | timestamptz | not null, default now |

Index: `deployment_logs_deployment_id_id_idx` on `(deployment_id, id)` for keyset pagination.

Status transitions are enforced by the application layer (`lib/build/status.ts`); see §3.

## 2. Proposed Normalized Target Schema

Principles:

- Postgres is the authoritative source for application metadata, ownership, subscription state, payment records, and lifecycle state.
- KV is a cache only; it never enforces financial correctness or quotas.
- Normalize by lifecycle, uniqueness, and ownership: applications, machines, volumes, backups, operations, subscriptions, payments, and usage are separate entities.

### 2.1 Applications

**Purpose:** the user-owned application record and its current desired state.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `user_id` | text | FK → `user.id` ON DELETE CASCADE (owner) |
| `name` | text | not null, check length 2–64 |
| `slug` | text | not null, unique (stable public identifier) |
| `plan_id` | uuid | FK → `plans.id` (nullable until first subscription) |
| `subscription_id` | uuid | FK → `subscriptions.id` (nullable) |
| `status` | text | check in application state machine (see §4) |
| `region` | text | not null; validated against Fly region list |
| `runtime` | jsonb | requested runtime config (image, env overrides) |
| `requested_resources` | jsonb | requested RAM/CPU/storage at create time |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | `deleted_at` nullable (soft-delete) |
| `last_operation_at` | timestamptz | nullable |

- **Indexes:** `(user_id, status)` for the dashboard list "my apps by status"; `(user_id, updated_at DESC)` for "recent apps"; unique `slug`.
- **Deletion behavior:** `user_id` cascade on user delete; soft delete for apps with deferred hard delete after machine/volume teardown.

### 2.2 Plans

**Purpose:** plan catalog and entitlements (config data, product decisions on values).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `code` | text | unique, e.g. `free`, `pro` |
| `name` | text | not null |
| `price_bdt` | integer | nullable until pricing decided |
| `currency` | text | default `BDT` |
| `billing_period_days` | integer | e.g. 30 |
| `entitlements` | jsonb | machine size, max apps, max volumes, backup retention, features |
| `is_active` | boolean | not null, default true |
| `created_at` / `updated_at` | timestamptz | not null |

### 2.3 Subscriptions

**Purpose:** the user's plan contract over time.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `user_id` | text | FK → `user.id` |
| `plan_id` | uuid | FK → `plans.id` |
| `status` | text | check: `trialing | active | past_due | cancelled | expired` |
| `current_period_start` / `current_period_end` | timestamptz | not null |
| `cancel_at_period_end` | boolean | default false |
| `provider_subscription_ref` | text | nullable (bKash/token reference) |
| `created_at` / `updated_at` | timestamptz | not null |

- **Unique:** one `active` subscription per user is enforced by partial unique index (`user_id`) WHERE `status IN ('trialing','active','past_due')`.
- **Indexes:** `(user_id, status)`, `(status, current_period_end)` for expiry jobs.

### 2.4 Payment transactions and events

**Purpose:** authoritative payment ledger and raw provider events.

`payment_transactions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `user_id` | text | FK → `user.id` |
| `subscription_id` | uuid | nullable FK |
| `amount` | integer | not null (minor units BDT) |
| `currency` | text | not null |
| `status` | text | check: `initiated | pending | succeeded | failed | refunded` |
| `idempotency_key` | text | not null, unique (bKash `merchantInvoiceNumber`) |
| `provider_ref` | text | nullable (bKash payment ID) |
| `error` | jsonb | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

`payment_events` (raw callback/webhook payloads)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `transaction_id` | uuid | FK → `payment_transactions.id` |
| `event_type` | text | not null |
| `raw_payload` | jsonb | not null |
| `verified` | boolean | default false (server-side verification result) |
| `received_at` | timestamptz | not null |

- **Unique:** `idempotency_key` prevents double-charge on duplicate callbacks.
- **Retention:** payment events retained for audit (≥ 7 years or per legal decision).

### 2.5 Machines and lifecycle

**Purpose:** Fly Machine identity and runtime state.

`machines`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `application_id` | uuid | FK → `applications.id` ON DELETE CASCADE |
| `fly_machine_id` | text | nullable until created; unique when set |
| `fly_app_id` | text | nullable |
| `status` | text | not null; check: `provisioning | running | stopped | stopping | starting | restarting | redeploying | failed | destroying | destroyed` |
| `region` | text | not null |
| `instance_number` | integer | not null default 0 (replica identifier) |
| `shared_ipv4` / `shared_ipv6` | text | nullable (allocated by provider config) |
| `public_url` | text | nullable |
| `allocated_resources` | jsonb | nullable (actual RAM/CPU from Fly) |
| `error` | jsonb | nullable |
| `created_at` / `updated_at` | timestamptz | not null |

- **Unique:** `(application_id)` — one active machine per app in MVP (partial index WHERE `status <> 'destroyed'`).

`provisioning_operations` (operation/audit history)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `application_id` | uuid | FK → `applications.id` ON DELETE CASCADE |
| `machine_id` | uuid | nullable FK → `machines.id` |
| `type` | text | check: `create | start | stop | restart | redeploy | delete | volume_create | volume_delete | backup | restore | plan_change` |
| `status` | text | check: `queued | running | succeeded | failed | cancelled` |
| `idempotency_key` | text | not null, unique |
| `attempt` | integer | default 0 |
| `max_attempts` | integer | default 5 |
| `error` | jsonb | nullable |
| `started_at` / `finished_at` | timestamptz | nullable |
| `created_at` | timestamptz | not null |

- **Indexes:** `(application_id, created_at DESC)` for operation history; unique `idempotency_key`.

### 2.6 Volumes

**Purpose:** persistent volumes attached to machines.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `application_id` | uuid | FK → `applications.id` ON DELETE CASCADE |
| `machine_id` | uuid | nullable FK → `machines.id` |
| `fly_volume_id` | text | nullable; unique when set |
| `name` | text | not null |
| `size_gb` | integer | not null, check > 0 |
| `mount_path` | text | not null |
| `status` | text | check: `creating | attached | detaching | detached | destroyed` |
| `created_at` / `updated_at` | timestamptz | not null |

### 2.7 Backups

**Purpose:** R2 backup objects and their integrity metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `application_id` | uuid | FK → `applications.id` ON DELETE CASCADE |
| `operation_id` | uuid | nullable FK → `provisioning_operations.id` |
| `r2_key` | text | not null, unique (object key) |
| `size_bytes` | bigint | not null |
| `checksum_sha256` | text | not null |
| `encryption_alg` | text | not null (e.g. `aes-256-gcm`) |
| `status` | text | check: `creating | stored | restoring | verified | failed | quarantined | deleted` |
| `retention_until` | timestamptz | not null |
| `created_at` | timestamptz | not null |

### 2.8 Usage records

**Purpose:** metered usage aggregates for quota enforcement and billing.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `application_id` | uuid | FK → `applications.id` ON DELETE CASCADE |
| `bucket_start` | timestamptz | not null |
| `bucket_end` | timestamptz | not null |
| `storage_bytes` | bigint | default 0 |
| `cpu_seconds` | bigint | default 0 |
| `egress_bytes` | bigint | default 0 |

- **Unique:** `(application_id, bucket_start)`.

### 2.9 Idempotency and outbox

`idempotency_records`

| Column | Type | Notes |
| --- | --- | --- |
| `key` | text | PK |
| `operation_id` | uuid | nullable FK |
| `response_status` | integer | nullable |
| `response_body` | jsonb | nullable |
| `created_at` | timestamptz | not null |

`outbox`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `aggregate_type` | text | not null (e.g. `application`) |
| `aggregate_id` | text | not null |
| `event_type` | text | not null |
| `payload` | jsonb | not null |
| `status` | text | check: `pending | published | failed` |
| `created_at` / `published_at` | timestamptz | nullable |

- **Purpose:** transactional outbox keeps DB changes and queue publication consistent.

### 2.10 Audit logs

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `user_id` | text | nullable FK |
| `action` | text | not null (e.g. `subscription.activated`, `application.deleted`) |
| `target_type` / `target_id` | text | nullable |
| `ip` | inet | nullable |
| `metadata` | jsonb | nullable |
| `created_at` | timestamptz | not null |

- **Retention:** ≥ 1 year, then archive.

### 2.11 Webhook events

`webhook_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | bigserial | PK |
| `provider` | text | not null |
| `event_id` | text | nullable |
| `payload` | jsonb | not null |
| `received_at` | timestamptz | not null |
| `processed_at` | timestamptz | nullable |

- **Unique:** `(provider, event_id)` where provider event IDs exist.

## 3. State Transitions and Invariants

- Applications: `pending → provisioning → running | failed`; `running → stopping → stopped`; `stopped → starting → running`; `deleting → deleted`. No transition from `deleted`.
- Payments: `initiated → pending → succeeded | failed`; `succeeded → refunded` (only via server-side verified event).
- Deployments: `queued → preparing → building → pushing → deploying → active`. Any in-flight state may move to `failed` or `cancelled`. Only a terminal state (`active | failed | cancelled`) may move back to `queued` (retry), which increments `build_number`. Same-state updates are idempotent (used for builder heartbeats). Enforced by `lib/build/status.ts` (`canTransition`) and the DB check constraint.
- One active subscription per user (partial unique index).
- One non-destroyed machine per application (partial unique index).
- Machine lifecycle operations are serialized per application via `provisioning_operations` status guard (409 if a `queued|running` operation exists).

## 4. Drizzle Example (proposed, aligns with installed `drizzle-orm` 0.45.x and repo conventions)

```ts
// lib/db/product-schema.ts (proposed)
import { pgTable, text, timestamp, uuid, integer, boolean, jsonb, index, check, sql } from "drizzle-orm/pg-core";
import { user } from "./schema";

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  planId: uuid("plan_id"),
  status: text("status").notNull().default("pending"),
  region: text("region").notNull(),
  runtime: jsonb("runtime"),
  requestedResources: jsonb("requested_resources"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  index("applications_user_status_idx").on(table.userId, table.status),
  index("applications_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const paymentTransactions = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("BDT"),
  status: text("status").notNull().default("initiated"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  providerRef: text("provider_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("payment_status_check", sql`${table.status} in ('initiated','pending','succeeded','failed','refunded')`),
]);
```

## 5. Optimization Analysis

### 5.1 N+1 query risks

- Dashboard list must join `applications` → `machines`/`subscriptions` in a single query (Drizzle `with`/left join), never per-row fetches.
- Application detail page: one query with joins for machine, volumes summary, current subscription; separate paginated queries for operations and backups.

### 5.2 Indexes and the queries they accelerate

| Index | Accelerates | Write/storage cost |
| --- | --- | --- |
| `applications(user_id, status)` | "my apps filtered by status" dashboard | low; moderate |
| `applications(user_id, updated_at DESC)` | "recent apps" ordering | low |
| `applications.slug` unique | lookup by stable ID | low |
| `payment_transactions.idempotency_key` unique | duplicate-callback guard | low |
| `provisioning_operations(application_id, created_at DESC)` | operation history pagination | moderate |
| `provisioning_operations.idempotency_key` unique | duplicate queue delivery | low |
| `subscriptions(user_id, status)` partial | active subscription lookup | low |
| `backups(application_id, created_at DESC)` | backup list | moderate |
| `usage_records(application_id, bucket_start)` unique | upsert metering buckets | moderate |

Do not add indexes speculatively; add each with its query and re-evaluate under load.

### 5.3 Pagination

- Use keyset pagination on `(updated_at, id)` / `(created_at, id)` for operations and backups; avoid `OFFSET` on large tables.

### 5.4 Selective column loading

- List endpoints select only list columns (name, status, region, updated_at); detail endpoints select full rows.

### 5.5 Transaction boundaries

- Create-app: insert application + insert outbox row + enqueue → commit atomically.
- Payment success: verify provider → update transaction → activate subscription → audit → all in one transaction; publish via outbox after commit.
- Quota enforcement: `SELECT ... FOR UPDATE` or constraint-based checks inside the create transaction.

### 5.6 Connection pooling (Neon)

- Current: neon-http with `neonConfig.fetchConnectionCache = true` (`lib/db/index.ts`).
- Proposed: keep HTTP driver for Worker compatibility; avoid holding transactions across awaits; bound queries per request; use Neon pooled connection string in production.

### 5.7 Cacheable results and invalidation

- Cache plans catalog, regions, and status summaries in KV with versioned keys (`plans:v3`). Never cache payment/subscription/quota authority.
- Invalidate on admin edits by bumping the version key.

### 5.8 Avoiding stale state

- All writes that change subscription/payment/lifecycle state go through Postgres transactions; KV reads are advisory only.
- Reconciliation jobs re-assert `machines.status` from Fly and `subscriptions.status` from provider.

### 5.9 Safe deletion and cleanup

- Soft-delete applications; hard-delete only after machine/volume teardown confirmed.
- Cascade: user delete → applications (teardown worker must handle orphaned machines first — see `architecture.md`).
- Backups deleted from R2 first, then row; retention enforced by scheduled job.

### 5.10 Concurrency control

- Per-application operation lock: one `queued|running` operation guard per application (enforced in `provisioning_operations`).
- Optimistic locking (`updated_at` compare) for `PATCH /applications/{id}`.

### 5.11 Migration strategy

- Additive-only migrations generated by `drizzle-kit generate`; apply to a Neon branch first; backfill in small batches; no destructive column drops in the same migration as feature code.
