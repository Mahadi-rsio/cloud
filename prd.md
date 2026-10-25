# Product Requirements Document (PRD) — Cloud Hosting Platform

> **Status:** Living document. Requirements marked **Implemented** reflect behavior verified in the current source tree at commit `d6265a6`; requirements marked **Proposed** describe the target platform and are **not** implemented in the repository.
> **Related documents:** [`architecture.md`](./architecture.md), [`api.md`](./api.md), [`plan.md`](./plan.md), [`db.md`](./db.md), [`todo.md`](./todo.md)

## 1. Product Overview and Vision

### 1.1 Overview

The product under documentation is a low-cost, Render-like cloud hosting platform. Authenticated users can create, configure, start, stop, update, back up, and delete application instances that run on Fly.io Machines.

The repository is named `cloud`, and the in-product product name used by the UI shell is **"Cloud"**.

### 1.2 Vision

Enable independent developers and small teams to deploy their own web applications on dedicated, isolated runtime machines without needing to operate Fly.io directly. The control plane (this Next.js application) owns the relationship with Fly.io, persists application, subscription, and billing state in Postgres, and exposes a dashboard for lifecycle management.

### 1.3 Verified Current State

As of the inspected source tree, the following are **implemented and verified**:

| Capability | Evidence in repository |
| --- | --- |
| Email/password authentication via Better Auth | `lib/auth/index.ts`, `lib/validators/auth.ts`, `app/api/auth/[...all]/route.ts`, `components/auth/*` |
| Session guard in authenticated route group | `app/(app)/layout.tsx` (redirects to `/login` when unauthenticated) |
| Sign-in / sign-up / sign-out / update-user / delete-user flows | `components/auth/login-form.tsx`, `components/settings/settings-form.tsx` |
| Welcome-email queue job on user creation | `lib/auth/index.ts` database hook, `lib/queue.ts`, `entrypoints/worker.ts` |
| Cloudflare KV as Better Auth secondary storage | `lib/auth/storage/kv.ts`, `cloudflare.config.ts` (`AUTH_KV`) |
| Neon Postgres persistence via Drizzle ORM (Better Auth tables only) | `lib/db/schema.ts`, `lib/db/index.ts`, `drizzle/0000_luxuriant_toad.sql` |
| Cloudflare Queue `auth-jobs` with worker consumer | `cloudflare.config.ts`, `lib/queue.ts`, `entrypoints/worker.ts` |
| Dashboard shell (app bar, sidebar, user menu, dark mode, mobile sidebar) | `components/shell/*` |
| Static placeholder pages | `app/(app)/docs/page.tsx`, `app/(app)/privacy/page.tsx` |

### 1.4 Proposed State (Not Implemented)

The following capabilities are **proposed** and must not be described as current behavior:

- Application creation with plan/runtime selection.
- Provisioning through the Fly.io Machines API.
- Start / stop / restart / redeploy lifecycle operations.
- Fly.io Machines and Volumes management.
- Plans, subscriptions, and usage metering.
- bKash payment initiation, callback handling, and server-side verification.
- Backups and restores via Cloudflare R2.

A repository-wide search for `fly`, `bKash`, `stripe`, `payment`, `subscription`, and `provision` returned no production source hits outside of placeholder billing copy; Fly.io, R2, bKash, and payment integrations are **Not implemented**.

## 2. Problem Statement and Target Customers

### 2.1 Problem

Small teams and independent developers who use Render-like platforms must currently either operate their own Fly.io infrastructure or pay a provider that manages it for them. There is no single low-cost control plane that:

1. owns the full application lifecycle record,
2. provisions isolated Fly Machines with the correct runtime configuration,
3. handles billing and plan entitlements,
4. backs up and restores application data, and
5. exposes an auditable operation history.

### 2.2 Target Customers

- Independent developers hosting personal or prototype projects.
- Small teams that want a single account and billing surface for multiple applications.
- Early-stage startups that need low-cost, per-app isolation before migrating to a higher-tier plan.

## 3. Product Goals and Measurable Success Criteria

| # | Goal | Success Metric | Status |
| --- | --- | --- | --- |
| 1 | User can create an application quickly | Time from authenticated create-click to provisioning request | Proposed (no implementation yet) |
| 2 | Lifecycle operations are idempotent and observable | Duplicate queue delivery handled without double-provisioning | Partially verified (auth queue only, no idempotency set) |
| 3 | Users only access their own applications | Automated cross-tenant access tests pass | Proposed (no app tables yet) |
| 4 | Billing state is authoritative in the database | Reconciliation job between DB and provider state exists | Proposed |
| 5 | Backups are encrypted, retained, and restorable | Restore drill success rate tracked | Proposed |

## 4. Non-Goals and Explicit Scope Boundaries

- **Not in scope (current release):** multi-tenant admin console for platform operators, custom domains and SSL automation, horizontal scaling beyond a single Fly Machine per app, on-prem deployment, direct provider console embedding.
- **Out of scope:** users selecting arbitrary Fly resources; users choosing arbitrary host/port bypass paths; acceptance of client-supplied payment status.
- **Explicit boundary:** the control plane never proxies application traffic directly; runtime traffic flows provider → Fly Machine → public URL. The control plane holds metadata only.

## 5. User Personas and Primary Use Cases

| Persona | Primary Use Cases |
| --- | --- |
| Solo developer | Sign up, create an app from a runtime preset, monitor status, stop/start, upgrade plan, back up data, delete app. |
| Small team | Shared application ownership and team billing (proposed). |

## 6. User Journeys

1. **Registration → sign-in:** sign-up with name/email/password (validated by `signUpSchema`: name ≥ 2 chars, valid email, password 8–72 chars) → Better Auth creates user + credentials account → welcome-email job enqueued to the `auth-jobs` queue → (currently) the job is logged by `entrypoints/worker.ts`.
2. **Dashboard → application creation:** authenticated user opens `/apps` → creates an app → selects plan/runtime → control plane provisions a Fly Machine → status transitions from `pending` to `provisioning` to `running`.
3. **Management:** start / stop / restart / redeploy / delete.
4. **Upgrade:** change plan subject to billing and resource constraints.
5. **Backup:** create backup → object stored in R2 → list/restore.
6. **Deletion:** delete app → stop machine → release volume (if any) → mark deleted, then cleanup expired resources.

## 7. Functional Requirements

### 7.1 Authentication — Implemented

- Email/password sign-up, sign-in, sign-out, session retrieval, profile update, account deletion with password confirmation.
- Email verification disabled (`requireEmailVerification: false`); password policy 8–72 chars.
- Welcome-email async job enqueued on user creation.

### 7.2 Dashboard Shell — Implemented

- Authenticated layout guard, sidebar navigation (Apps, Billing, Settings, Docs, Privacy), user menu, dark mode toggle, mobile sidebar, sign-out.

### 7.3 Applications — Proposed

- CRUD, lifecycle ops, machine/volume info, status polling, plan and runtime configuration.

### 7.4 Billing and Payments — Proposed

- Plans, subscriptions, bKash payment initiation/callback/verification, payment history.

### 7.5 Backups — Proposed

- Encrypted backups in R2, retention, restore with validation.

## 8. Non-Functional Requirements

- **Security:** server-side auth only; per-user ownership checks; server-side payment verification; secrets server-side with least privilege; SSRF-safe URL handling; audit logs for sensitive actions; rate limits on expensive operations.
- **Reliability:** at-least-once queue delivery with idempotent handlers; retries with dead-letter handling; reconciliation of DB vs provider state.
- **Latency:** lifecycle ops return quickly with async provisioning; status polling for progress.
- **Scalability:** stateless control plane; KV for cache; Postgres authoritative; queue fan-out for jobs.
- **Observability:** structured logs, metrics, audit events, error tracking.
- **Cost:** low-cost plans; no long-running work in synchronous requests.

## 9. Plans, Quotas, Resource Limits, and Billing Behavior

- Plan catalog, pricing, and quota values are **undecided** and must be treated as configuration/product decisions. No final prices or quota values are invented in this document.
- Proposed quota dimensions (to be finalized as product decisions): max apps per user, machine RAM/CPU/storage per plan, max stopped apps, backup retention window.
- Billing behavior (proposed): subscription state machine (trialing → active → past_due → cancelled); failed-payment handling; plan upgrades/downgrades subject to resource constraints.

## 10. Application Lifecycle and State Transitions

Proposed state machine:

- `pending` → `provisioning` → `running | failed`
- `running` → `stopping` → `stopped`
- `stopped` → `starting` → `running`
- `running | stopped | failed` → `deleting` → `deleted`
- Transient action states: `restarting`, `redeploying`.

All transitions must be idempotent and recorded as operations.

## 11. Failure Scenarios and Recovery Behavior

- Duplicate queue delivery → idempotency keys per operation.
- Provisioning failure → retry with backoff, surface error, clean up partial resources.
- Payment callback loss → reconcile from provider via scheduled job.
- Restore validation failure → quarantine backup, mark restore failed.

## 12. UI Requirements

- Dashboard, application details, resource settings, billing, backups, and operation history pages (proposed).
- Status badges, action buttons with pending states, inline error surfaces, and confirmation dialogs for destructive actions.

## 13. Acceptance Criteria

- AC-1: unauthenticated users cannot access authenticated pages (implemented via `app/(app)/layout.tsx` redirect).
- AC-2: authenticated users can create an app and receive a provisioning operation (proposed).
- AC-3: lifecycle operations are idempotent under duplicate delivery (proposed).
- AC-4: payment status is verified server-side and callbacks authenticated (proposed).
- AC-5: deleted applications are unreachable by any user after cleanup (proposed).

## 14. Assumptions, Dependencies, Risks, and Unresolved Decisions

- bKash merchant account access is pending; Fly.io API token is pending; KV session storage is implemented with an in-memory fallback for local dev.
- Next.js version is non-standard (16.4.3 via vinext) — read `node_modules/next/dist/docs/` before making changes (per `AGENTS.md`).
- Open questions: final plan names/prices/quotas (product decision); whether email verification is enabled post-MVP (product decision); bKash callback authenticity contract (awaiting provider documentation).
