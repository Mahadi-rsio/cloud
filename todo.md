# Engineering Checklist — Cloud Hosting Platform

> **Legend:** `[x]` = verified implemented in the source tree. `[ ]` = incomplete, proposed, or unverified. Proposed file paths are labeled `(proposed)`.
> **Related documents:** [`prd.md`](./prd.md), [`api.md`](./api.md), [`architecture.md`](./architecture.md), [`db.md`](./db.md), [`plan.md`](./plan.md)

## P0 — Critical blockers, security, data integrity

- [x] Email/password sign-up with server-side validation (`lib/validators/auth.ts`, `app/api/auth/[...all]/route.ts`)
- [x] Sign-in and session cookie issuance (Better Auth, `lib/auth/index.ts`)
- [x] Authenticated route group redirects unauthenticated users to `/login` (`app/(app)/layout.tsx`)
- [x] Account deletion requires the current password (`components/settings/settings-form.tsx` → `POST /api/auth/delete-user`)
- [x] Secrets are bound as Worker secrets, not committed (`cloudflare.config.ts`; `.env*` and `.dev.vars` are gitignored)
- [x] Enforce per-user application ownership server-side on every product endpoint (`lib/authz.ts`; implemented for application create/update/delete)
- [ ] Never trust client-supplied payment status; verify bKash server-side (`app/api/v1/bkash/verify` — proposed)
- [ ] Idempotency keys for create/delete/lifecycle/payment/backup operations (`idempotency_records` table — proposed)
- [x] Rate limits on auth (Better Auth built-in, KV secondary-storage) and provisioning/update/delete (`lib/rate-limit.ts`); payment endpoints still proposed
- [ ] Do not log or expose `DATABASE_URL`, Fly token, or bKash secrets in responses/logs

## P1 — Required for MVP

### Auth and session
- [x] Sign-out (`POST /api/auth/sign-out` via `components/auth/sign-out-button.tsx`, `components/shell/user-menu.tsx`, `components/shell/sidebar.tsx`)
- [x] Update display name (`POST /api/auth/update-user`, `components/settings/settings-form.tsx`)
- [x] Welcome-email job enqueued on user creation (`lib/auth/index.ts` database hook → `lib/queue.ts` → `auth-jobs`)
- [ ] Add email verification or explicit product decision to keep disabled (`lib/auth/index.ts`, `requireEmailVerification: false`)

### Queue and async
- [x] Queue binding `AUTH_JOBS` and worker consumer for `welcome-email` (`cloudflare.config.ts`, `entrypoints/worker.ts`)
- [ ] Make `welcome-email` consumer robust: retries, logging, DLQ (proposed; currently only `console.log`)
- [ ] Add product job queues (provisioning/lifecycle/backups) with idempotent consumers (proposed)

### Applications and provisioning (partially implemented)
- [x] `applications` and `machines` tables plus create/update/delete/list/detail API (`lib/db/product-schema.ts`, `app/api/v1/applications/**`)
- [x] Application creation with runtime/region selection (no plan/quota selection yet)
- [x] Fly Machines client with synchronous provisioning (`lib/fly/client.ts`; no queue worker/outbox yet)
- [ ] Start / stop / restart / redeploy lifecycle operations (delete is implemented)
- [ ] Machine status and error surfacing in the UI

### Billing (all proposed)
- [ ] Plans catalog and entitlements (values are product decisions)
- [ ] Subscriptions with plan change/cancel (`app/api/v1/subscriptions/**`)
- [ ] bKash create-payment, callback, and server-side verify with idempotency

### Dashboard UI
- [x] App shell: sidebar, app bar, user menu, dark mode, mobile sidebar (`components/shell/*`, `stores/*`)
- [x] Login page and auth form modes (`app/(auth)/login/page.tsx`, `components/auth/login-form.tsx`)
- [x] Settings page: profile, session, delete account (`app/(app)/settings/page.tsx`, `components/settings/settings-form.tsx`)
- [ ] Real Apps list and detail pages (currently placeholders: `app/(app)/apps/page.tsx`)
- [ ] Real Billing page (currently placeholder: `app/(app)/billing/page.tsx`)

## P2 — Important improvements

- [ ] Centralize session checks in `middleware.ts` instead of per-page `getSession()` + `redirect` duplication
- [ ] Replace axios (`lib/api.ts`) with a typed `fetch` client + Zod validation (`lib/http.ts` exists for product endpoints; client adoption still pending) per target stack
- [ ] Deduplicate `extractErrorMessage` (duplicated in `components/auth/login-form.tsx` and `lib/errors.ts`)
- [ ] Add `GET /api/health` readiness endpoint (proposed)
- [ ] Application detail pages: resource settings, volumes, operations history, logs UI (proposed)
- [ ] Backup list/create/restore/delete API + UI (`app/api/v1/applications/{id}/backups` — proposed)
- [ ] KV caching for plans/regions/status with explicit invalidation (`lib/cache.ts` — proposed)
- [ ] Structured audit log table + writes on sensitive actions (`audit_logs` — proposed)
- [ ] Pagination, filtering, sorting conventions on list endpoints (see `api.md`)

## P3 — Future enhancements

- [ ] Reconciliation worker: DB machine state vs Fly API state
- [ ] Usage metering and quota enforcement (`usage_records`, `quotas` — proposed)
- [ ] Restore validation drills and backup retention policy enforcement
- [ ] Team/org accounts with shared app ownership
- [ ] Custom domains / SSL automation (out of MVP scope)
- [ ] Observability dashboards: error telemetry, queue depth, DLQ alerting
- [ ] CI: lint, typecheck, tests, build on every PR (no test infrastructure exists today)

## Testing, migrations, observability, docs, deploy verification

- [ ] Establish test framework; add authz, idempotency, billing, backup tests (`tests/**` — proposed)
- [ ] Run `drizzle-kit generate` + review every migration before apply; keep migrations additive
- [ ] Verify `[x]` items on this list by reading source, not by assumption
- [ ] Keep `prd.md`, `api.md`, `architecture.md`, `db.md`, `plan.md`, `todo.md` in sync when requirements change
- [ ] Verify `pnpm build`/`pnpm deploy:vinext` pipeline in preview before production deploy
