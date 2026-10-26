# Implementation Roadmap — Cloud Hosting Platform

> **Status:** This roadmap is grounded in the actual repository state (commit `d6265a6`). Phases reflect a suggested order; adjust as product decisions land.
> **Related documents:** [`prd.md`](./prd.md), [`api.md`](./api.md), [`architecture.md`](./architecture.md), [`db.md`](./db.md), [`todo.md`](./todo.md)

## Current Implementation Baseline (verified)

- Next.js 16.4.3 (vinext) + Cloudflare Workers, Better Auth + Neon/Drizzle (auth tables, plus `applications`/`machines`), KV secondary storage, one queue (`auth-jobs`) with a logging consumer, shadcn/ui shell, TanStack Query in forms, Zustand for UI state.
- Applications and machines tables plus create/update/delete API and a synchronous Fly Machines client exist. Billing, payments, volumes, backups, and usage code do not.

## Phase 0 — Codebase audit and foundational cleanup

- **Objective:** stabilize the foundation and remove debt before feature work.
- **Current status:** Mostly implemented (shell, auth, DB wiring exist).
- **Prerequisites:** none.
- **Tasks:**
  - Add `middleware.ts` to centralize session checks (currently repeated `getSession()` + `redirect` per page in `app/(app)/layout.tsx`, `app/(app)/settings/page.tsx`).
  - Replace the axios dependency (`lib/api.ts`) with a thin typed `fetch` client (`lib/http.ts`) using Zod-validated responses, per the target stack note ("Native fetch wrapped in a small, typed API client").
  - Extract `extractErrorMessage` duplication (`components/auth/login-form.tsx` vs `lib/errors.ts`) by reusing `lib/errors.ts`.
  - Remove placeholder page copy or replace with real page skeletons.
- **Expected files:** `lib/http.ts` (new), `middleware.ts` (new), edits to `components/auth/login-form.tsx`, `lib/api.ts`.
- **Migrations:** none.
- **Tests/verification:** `pnpm typecheck`, `pnpm build`; manual sign-in/sign-up.
- **Risks:** Next 16 non-standard APIs — read `node_modules/next/dist/docs/` before changes.
- **Definition of done:** typecheck clean; no duplicate error helpers; fetch client used by one component.

## Phase 1 — Database schema and migration foundations

- **Objective:** create the product schema (see [`db.md`](./db.md)) and migration pipeline.
- **Current status:** Partially implemented: `applications` and `machines` exist; plans, subscriptions, payments, volumes, backups, operations, idempotency, outbox, audit, and usage remain.
- **Prerequisites:** Phase 0.
- **Tasks:**
  - Add `lib/db/product-schema.ts` with Drizzle tables: `applications`, `plans`, `subscriptions`, `payment_transactions`, `payment_events`, `machines`, `volumes`, `backups`, `provisioning_operations`, `idempotency_records`, `outbox`, `audit_logs`, `usage_records`.
  - Wire the schema into `lib/db/index.ts` (implemented: merges auth and product schemas).
  - Generate migration `0001_*.sql` with `drizzle-kit generate`; review SQL.
- **Expected files:** `lib/db/product-schema.ts` (new), `drizzle/0001_*.sql` (new).
- **Migrations:** one additive migration; no destructive changes.
- **Tests/verification:** `drizzle-kit check`; apply to a disposable Neon branch; verify FK and unique constraints.
- **Risks:** Neon branch/pooler connection limits; keep migrations additive.
- **Definition of done:** `drizzle-kit generate` produces a reviewed migration; `lib/db` exposes product tables.

## Phase 2 — Application API and ownership enforcement

- **Objective:** CRUD API for applications with ownership checks.
- **Current status:** Partially implemented: create/update/delete with ownership and validation exist; list/get and the real `/apps` UI remain.
- **Prerequisites:** Phase 1.
- **Tasks:**
  - Create `app/api/v1/applications/route.ts` (list/create) and `app/api/v1/applications/[id]/route.ts` (get/update/delete).
  - Add Zod schemas in `lib/validators/application.ts`.
  - Add an ownership helper (`lib/authz.ts`) asserting `app.userId === session.user.id`.
  - Adopt the response envelope from [`api.md`](./api.md).
- **Expected files:** `app/api/v1/applications/**` (new), `lib/validators/application.ts` (new), `lib/authz.ts` (new).
- **Migrations:** none beyond Phase 1.
- **API/UI changes:** `/apps` page renders the real application list.
- **Tests/verification:** cross-tenant test (user B cannot read user A's app) returns 403; create returns 201 with envelope.
- **Risks:** accidental data exposure; always query-scope by `userId`.
- **Definition of done:** all CRUD endpoints enforce ownership; `apps` page lists rows from the DB.

## Phase 3 — Fly Machines provisioning and lifecycle orchestration

- **Objective:** provision and manage Fly Machines from the backend.
- **Current status:** Partially implemented: `lib/fly/client.ts` provisions and tears down machines synchronously; queues, outbox, and lifecycle operations remain.
- **Prerequisites:** Phase 2; Fly API token available as a secret.
- **Tasks:**
  - Add `lib/fly/client.ts` wrapping the Fly Machines API (create/start/stop/restart/delete/list).
  - Add queue bindings `PROVISION_JOBS`/`LIFECYCLE_JOBS` in `cloudflare.config.ts`.
  - Add outbox publishing on create/start/stop/restart/delete; workers in `entrypoints/worker.ts` call the Fly client.
  - Persist `fly_machine_id` and status transitions in `machines`/`applications`.
- **Expected files:** `lib/fly/client.ts` (new), updates to `cloudflare.config.ts`, `lib/queue.ts`, `entrypoints/worker.ts`, `lib/db/product-schema.ts`.
- **Migrations:** add `fly_machine_id`, `region`, `status` columns if not already in Phase 1 design.
- **API/UI changes:** machine status visible on the app detail page.
- **Tests/verification:** dry-run against a sandbox Fly org; simulate provisioning failure → retry then `failed`.
- **Risks:** Fly API rate limits, token leakage (never client-side), partial provisioning → cleanup path required.
- **Definition of done:** create provisions a real machine; lifecycle ops idempotent under duplicate queue delivery.

## Phase 4 — Queue workers, idempotency, retries, reconciliation

- **Objective:** harden async processing.
- **Current status:** Only the `welcome-email` job exists (no retry/idempotency).
- **Prerequisites:** Phase 3.
- **Tasks:**
  - Add `idempotency_records` unique-constraint checks in every worker.
  - Configure queue retries and a dead-letter queue in `cloudflare.config.ts`.
  - Add a scheduled reconciliation worker comparing `machines.status` with Fly API state.
  - Enrich `welcome-email` handling with retry and observability.
- **Expected files:** `entrypoints/worker.ts`, `cloudflare.config.ts`, `lib/queue.ts`.
- **Migrations:** `idempotency_records` (from Phase 1) — add if missing.
- **Tests/verification:** enqueue duplicate messages; assert single side effect; force failure and assert DLQ capture.
- **Risks:** at-least-once delivery requires idempotent handlers by design.
- **Definition of done:** duplicate deliveries produce no double-provision; DLQ path tested.

## Phase 5 — Dashboard and application management UI

- **Objective:** full application management UI.
- **Current status:** `/apps` list and `/apps/[id]` detail implemented (create/update/delete/list/detail with status badges and runtime fields). Lifecycle ops (start/stop) and `/apps/[id]/settings` still pending.
- **Prerequisites:** Phases 2–3.
- **Tasks:**
  - Build `/apps` list, `/apps/[id]` detail, and `/apps/[id]/settings` pages.
  - Add TanStack Query queries for server-state fetching and mutations.
  - Render status badges and operation history from `operations` API.
- **Expected files:** `app/(app)/apps/**` (new), `components/apps/**` (new).
- **API/UI changes:** see above.
- **Tests/verification:** manual lifecycle flows; pending states during ops; 409 conflict surfaced.
- **Definition of done:** user can create, view, start/stop, and delete an app from the UI.

## Phase 6 — Plans, quotas, and bKash billing

- **Objective:** monetization.
- **Current status:** Not started; `/billing` is a placeholder.
- **Prerequisites:** Phase 4; bKash merchant credentials.
- **Tasks:**
  - Seed `plans` catalog (values are product decisions).
  - Implement subscriptions and quota checks in the create/volume/backup paths.
  - Implement bKash create-payment, callback, and server-side verify endpoints; idempotency on `merchantInvoiceNumber`.
  - Build `/billing` UI (plan cards, subscription, payment history).
- **Expected files:** `app/api/v1/billing/**`, `lib/bkash/*` (new), `components/billing/**` (new).
- **Migrations:** Phase 1 tables; seed data migration for plans.
- **Tests/verification:** duplicate callback does not double-charge; verify uses provider API, never client status.
- **Risks:** bKash sandbox limitations; callback authenticity — follow provider docs.
- **Definition of done:** subscribe → pay → plan active in DB; quota enforced in create.

## Phase 7 — R2 backups and restoration

- **Objective:** backup/restore eligible application data.
- **Current status:** Not started.
- **Prerequisites:** Phase 4; R2 bucket configured.
- **Tasks:**
  - Add `BACKUPS` R2 binding and backup/restore workers; store object keys, sizes, checksums, retention.
  - Encrypt backups at rest; verify checksums on restore; quarantine failures.
- **Expected files:** `lib/r2/*` (new), `lib/backup/*` (new).
- **Migrations:** Phase 1 `backups` table.
- **Tests/verification:** create → list → restore → checksum-match; restore to a scratch machine validates data.
- **Definition of done:** end-to-end backup and restore succeed in staging.

## Phase 8 — Rate limiting, security hardening, abuse prevention

- **Objective:** production security.
- **Current status:** Not started.
- **Prerequisites:** Phases 2–7.
- **Tasks:**
  - Add per-user rate limits (KV-backed counters) on expensive endpoints.
  - Add audit logging on sensitive actions; add SSRF guards for user-supplied URLs.
  - Add security headers; CSRF review for cookie auth.
- **Expected files:** `lib/rate-limit.ts` (new), `lib/audit.ts` (new), middleware updates.
- **Tests/verification:** burst tests; confirm 429; confirm audit rows on delete/payment.
- **Definition of done:** security checklist in `todo.md` (P0/P1) all closed.

## Phase 9 — Observability, testing, performance, production readiness

- **Objective:** production readiness.
- **Current status:** Not started (no tests exist in the repo).
- **Prerequisites:** Phases 0–8.
- **Tasks:**
  - Add test framework and unit/integration tests for authz, idempotency, billing, backups.
  - Add structured logging, health endpoint, alerting on DLQ and reconciliation drift.
  - Load-test list/status endpoints; tune Neon pool settings and indexes (see [`db.md`](./db.md)).
- **Expected files:** `tests/**` (new), `app/api/health/route.ts` (new).
- **Tests/verification:** `pnpm test`; CI runs lint, typecheck, tests, build.
- **Definition of done:** CI green; dashboards for errors/latency/queue depth; documented runbooks.
