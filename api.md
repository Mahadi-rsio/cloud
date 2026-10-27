# API Documentation — Cloud Hosting Platform

> **Status:** This document describes both the **current** API surface (implemented and verified) and the **proposed** target API. Endpoints marked **[Implemented]** exist today; endpoints marked **[Proposed]** do not yet exist.
> **Related documents:** [`prd.md`](./prd.md), [`architecture.md`](./architecture.md), [`db.md`](./db.md), [`plan.md`](./plan.md), [`todo.md`](./todo.md)

## 1. Conventions

### 1.1 Base URL

- Current: all client calls go through the axios instance in `lib/api.ts` with `baseURL: "/api/auth"`.
- Implemented for product endpoints: versioned namespace `/api/v1/`, keeping `/api/auth/*` for Better Auth. The apps UI uses the axios instance in `lib/api-v1.ts` (`baseURL: "/api/v1"`) via the typed client in `lib/applications.ts`.

### 1.2 Authentication

- Current: Better Auth session cookie (`better-auth` cookie prefix, `lib/auth/index.ts`). Server reads sessions via `getSession()` (`lib/auth/session.ts`) using `auth.api.getSession`.
- Implemented for product endpoints: the same session mechanism authorizes `/api/v1/*`; `requireUser()` in `lib/authz.ts` returns 401 when absent. `GET /api/auth/get-session` is the client-side way to refresh session state.

### 1.3 Response envelope

- Current: Better Auth endpoints return their own JSON shapes; the client (`lib/errors.ts`) reads `error.response.data.message` (string or array of `{ message }`).
- Implemented for product endpoints (`lib/http.ts`): one envelope for new endpoints:

```json
{
  "success": true,
  "data": { }
}
```

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "name is required."
  }
}
```

### 1.4 Error codes (implemented for product endpoints)

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod schema violation; details in `error.details` |
| 401 | `UNAUTHENTICATED` | Missing/expired session |
| 403 | `FORBIDDEN` | Authenticated but not owner |
| 404 | `NOT_FOUND` | Resource does not exist or is not visible to caller |
| 409 | `CONFLICT` | State conflict (e.g., op already in progress) |
| 422 | `PROVIDER_ERROR` | Upstream provider (Fly/bKash) returned an error |
| 429 | `RATE_LIMITED` | Rate limit exceeded |
| 500 | `INTERNAL` | Unhandled server error |

### 1.5 Validation

- Current: `lib/validators/auth.ts` (Zod v4) validates sign-in and sign-up input client-side and server-side.
- Implemented for product endpoints: `lib/validators/application.ts` validates application create/update bodies server-side with Zod v4.
- Proposed: every request body is validated server-side with Zod; shared schemas live in `lib/validators/`.

### 1.6 Pagination / filtering / sorting (implemented for applications)

- Collections use `?cursor=<opaque>` for keyset pagination, `?filter[status]=running`, and `?sort=updated_at_desc`.
- Response shape: `data.items`, `data.nextCursor`.
- Implemented on `GET /api/v1/applications`; `filter[status]` and `sort` follow the documented forms (see §3.1).

## 2. Current API — Implemented

All current endpoints are handled by the Better Auth catch-all route `app/api/auth/[...all]/route.ts` using `toNextJsHandler`. The axios client in `lib/api.ts` targets `/api/auth`.

### 2.1 `POST /api/auth/sign-up/email` — [Implemented]

- **Purpose:** create a user with email/password.
- **Auth:** none required.
- **Body (Zod `signUpSchema`):**
  - `name`: string, min 2
  - `email`: valid email (`z.email`)
  - `password`: string, min 8, max 72
- **Success:** 200; sets session cookie; user record created in Neon (`lib/db/schema.ts` `user` table).
- **Errors:** 422 on duplicate email, 400 on invalid input.
- **Side effects:** `databaseHooks.user.create.after` enqueues a `welcome-email` job to the `auth-jobs` Cloudflare Queue (`lib/auth/index.ts`, `lib/queue.ts`).
- **Security:** server-side password hashing by Better Auth; credentials stored in `account` table.

### 2.2 `POST /api/auth/sign-in/email` — [Implemented]

- **Purpose:** authenticate with email/password.
- **Auth:** none required.
- **Body (Zod `signInSchema`):** `email` (valid email), `password` (min 1).
- **Success:** 200; session cookie set.
- **Security:** rate limiting is delegated to Better Auth defaults (unverified); no custom rate limiter exists.

### 2.3 `POST /api/auth/sign-out` — [Implemented]

- **Purpose:** revoke the current session.
- **Auth:** session cookie.
- **Success:** 200; cookie cleared.

### 2.4 `POST /api/auth/update-user` — [Implemented]

- **Purpose:** update profile fields (used for display name in `components/settings/settings-form.tsx`).
- **Auth:** session required.
- **Body:** `{ name: string }` validated by `updateNameSchema` (trimmed, 1–100 chars).
- **Success:** 200; updated user.

### 2.5 `POST /api/auth/delete-user` — [Implemented]

- **Purpose:** permanently delete the account, confirming with the current password.
- **Auth:** session required.
- **Body:** `{ password: string }`.
- **Security:** Better Auth verifies the password and cascades deletes of linked accounts (`onDelete: cascade` on `account.user_id`).
- **Note:** account deletion cascades DB rows via `user_id`, but does not yet tear down Fly applications/machines or billing resources.

### 2.6 `GET /api/auth/get-session` — [Implemented]

- **Purpose:** return the current session (used implicitly by `getSession()` and the axios client where needed).
- **Auth:** cookie.
- **Success:** 200 with `{ session: {...} | null }`.

### 2.7 Other Better Auth endpoints — [Implemented via catch-all]

The `[...all]` catch-all also serves any other Better Auth route (`/callback/*`, `/error`, etc.). These are provider-managed and not documented individually.

## 3. Product API — Partially Implemented

Endpoints marked **[Implemented]** exist today; endpoints marked **[Proposed]** do not yet exist. File paths are actual for implemented endpoints and proposed locations otherwise.

### 3.1 Applications

| Endpoint | Auth | Body / Query | Success | Status |
| --- | --- | --- | --- | --- |
| `GET /api/v1/applications` | session | `?cursor&limit&filter[status]&sort` | `data.items`, `data.nextCursor` | Implemented |
| `POST /api/v1/applications` | session | `{ name, region?, runtime? }` | 201 `data.application`, `data.machine` | Implemented |
| `GET /api/v1/applications/{id}` | session + owner | — | `data.application`, `data.machines` | Implemented |
| `PATCH /api/v1/applications/{id}` | session + owner | `{ name?, region?, runtime? }` (at least one) | 200 `data.application` | Implemented |
| `DELETE /api/v1/applications/{id}` | session + owner | — | 200 `data.application` (soft-deleted) | Implemented |

- **Ownership (implemented):** `lib/authz.ts` resolves the session user and asserts `app.userId === session.user.id`; non-owners get 403 and missing/deleted rows get 404.
- **Validation (implemented):** `createApplicationSchema` requires `name` 2–64 chars; `updateApplicationSchema` requires at least one of `name`, `region`, `runtime`. `region` is a 3-letter Fly code. Bodies are strict (unknown keys rejected).
- **Runtime shape (implemented):** `{ image?, guest?: { cpu_kind?, cpus?, memory_mb? }, env?: Record<string,string>, internalPort? }`.
- **Slug (implemented):** generated server-side from the name plus a random suffix; clients cannot set it.
- **Delete semantics (implemented):** synchronous. Sets `deleting`, destroys the Fly machine and app (ignoring 404s), marks machines `destroyed`, then sets `deleted` + `deletedAt`. Returns 409 if deletion is already in progress.
- **Rate limits (implemented):** product endpoints are limited per IP via `lib/rate-limit.ts` (KV-backed, `AUTH_KV`): create 20/60s, update 60/60s, delete 30/60s, list and detail 120/60s. Exceeded requests return 429 `RATE_LIMITED` with `error.details.retryAfter`.
- **List/detail (implemented):** list returns non-deleted apps only, keyset-paginated on `(order column, id)` — `sort` is `updated_at_desc` (default), `updated_at_asc`, `created_at_desc`, `created_at_asc`; `cursor` is an opaque base64 token; `filter[status]` restricts by status. Detail returns the application plus its machines (newest last).
- **Networking (implemented):** on create, the app gets a **free shared IPv4** (Anycast) allocated via `POST /v1/apps/{app_name}/ip_assignments` with `type: "shared_v4"`, so it is reachable at `https://<app-name>.fly.dev` (`machine.publicUrl`). No **dedicated IPv4** and no **public IPv6** are ever allocated. The machine also gets its private 6PN address (free, internal network).
- **Not implemented:** `Idempotency-Key` handling, queue/outbox interaction, `data.operationId` responses, plan/quota selection.
- **Note:** create/update/delete call the Fly API synchronously from the route handlers; failures mark the application `failed` and attempt Fly cleanup.

### 3.2 Lifecycle operations

| Endpoint | Action |
| --- | --- |
| `POST /api/v1/applications/{id}/start` | transition to `starting` |
| `POST /api/v1/applications/{id}/stop` | transition to `stopping` |
| `POST /api/v1/applications/{id}/restart` | `restarting` |
| `POST /api/v1/applications/{id}/redeploy` | `redeploying` |

- **Semantics:** each returns `data.operationId` immediately; completion is asynchronous and tracked in the `provisioning_operations` table.
- **State guard:** 409 if an operation is already pending for the app.

### 3.3 Machines and volumes

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/applications/{id}/machine` | Fly Machine info (status, region, IPs, instance number) |
| `GET /api/v1/applications/{id}/volumes` | list volumes |
| `POST /api/v1/applications/{id}/volumes` | create volume (subject to plan quota) |
| `DELETE /api/v1/volumes/{id}` | destroy volume |
| `GET /api/v1/regions` | supported Fly regions (cached in KV) |

- **Security:** never returns provider tokens; machine identifiers are validated against DB ownership before any Fly API call.

### 3.4 Billing and subscriptions

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/plans` | list plans + entitlements (cacheable) |
| `POST /api/v1/subscriptions` | subscribe to a plan (idempotent by `Idempotency-Key`) |
| `GET /api/v1/subscriptions/current` | current subscription + expiry |
| `POST /api/v1/subscriptions/{id}/change` | upgrade/downgrade subject to constraints |
| `POST /api/v1/subscriptions/{id}/cancel` | cancel at period end |

### 3.5 bKash payments

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/bkash/create-payment` | initiate payment; returns payment URL/ref |
| `POST /api/v1/bkash/callback` | provider callback; MUST NOT trust the body alone |
| `POST /api/v1/bkash/verify` | server-side verification via bKash API using the payment reference |

- **Critical rule:** the callback handler never finalizes a subscription from a client-supplied status. It records the raw event, then calls bKash's server-side verification endpoint and reconciles with the stored `idempotency_key`. Verify callback authenticity per bKash's official documentation (expected signature/ip allow-list).
- **Idempotency:** bKash `merchantInvoiceNumber` is stored uniquely; duplicate callbacks return the stored result.

### 3.6 Backups

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/applications/{id}/backups` | create a backup job |
| `GET /api/v1/applications/{id}/backups` | list backups (filter by status) |
| `POST /api/v1/backups/{id}/restore` | restore a backup to the app |
| `DELETE /api/v1/backups/{id}` | delete a backup object from R2 + DB row |

### 3.7 Usage and quotas

- `GET /api/v1/usage` — metered usage for the current period.
- `GET /api/v1/quotas` — per-plan quota usage vs limits.

### 3.8 Operations and logs

- `GET /api/v1/applications/{id}/operations` — history (paginated).
- `GET /api/v1/applications/{id}/operations/{opId}` — operation status + error.
- `GET /api/v1/applications/{id}/logs` — recent runtime logs (provider-sourced, read-only).

### 3.10 Deployments (GitHub) — Implemented

Deployments build a public GitHub repository into an OCI image (Railpack or Dockerfile) and push it to a Fly machine. Public routes live in `app/api/v1/deployments/**`; internal builder callbacks in `app/api/v1/internal/deployments/**` (authenticated with `INTERNAL_API_TOKEN`).

| Endpoint | Auth | Body / Query | Success | Status |
| --- | --- | --- | --- | --- |
| `POST /api/v1/deployments` | session | `{ url }` | 201 `data.deployment` | Implemented |
| `GET /api/v1/deployments` | session | `?cursor&limit` | `data.items`, `data.nextCursor` | Implemented |
| `POST /api/v1/deployments/validate` | session | `{ url }` | `data.valid` + repo info or reason | Implemented |
| `GET /api/v1/deployments/{id}` | session + owner | — | `data.deployment` | Implemented |
| `POST /api/v1/deployments/{id}/retry` | session + owner | — | `data.deployment` (build_number incremented) | Implemented |
| `GET /api/v1/deployments/{id}/logs` | session + owner | `?after&limit` | `data.items`, `data.nextCursor`, `data.status`, `data.terminal` | Implemented |
| `GET /api/v1/deployments/{id}/logs/stream` | session + owner | `?after` (or `Last-Event-ID`) | `text/event-stream` | Implemented |
| `POST /api/v1/internal/deployments/{id}/logs` | `INTERNAL_API_TOKEN` | `{ lines: [{ stream, message, timestamp? }] }` | 204 | Implemented |
| `POST /api/v1/internal/deployments/{id}/status` | `INTERNAL_API_TOKEN` | `{ status, message? }` | 200 `data.deployment` | Implemented |
| `POST /api/v1/internal/deployments/{id}/complete` | `INTERNAL_API_TOKEN` | `{ imageRef, internalPort? }` | 200 `data.deployment` | Implemented |

- **Create (`POST /api/v1/deployments`):** rate-limited 10/min per IP. The URL must parse as `https://github.com/{owner}/{repo}` (no `.git` suffix, no tree/commit paths, no query/fragment — `lib/build/github.ts`). The repo is checked for public reachability via the GitHub API (server-side, no PAT required; 404→`missing`, 403/429→rate-limited, private→rejected). On success a deployment is inserted with status `queued`, `build_number = 1`, and a `build-jobs` queue message is enqueued.
- **Validate (`POST /api/v1/deployments/validate`):** 30/min. Returns `{ valid: true, repository: { owner, name, url, defaultBranch, fork, pushedAt } }` or `{ valid: false, reason, message }` (no exception on missing/private repos).
- **Logs (`GET .../logs`):** keyset-paginated on `(deployment_id, id)` using `after` (opaque numeric cursor) and `limit` (default 200, max 500). `terminal` mirrors `isTerminalStatus(deployment.status)`.
- **Stream (`GET .../logs/stream`):** `text/event-stream`. Polls Postgres every 3s, sends a heartbeat comment every 10s, and closes after 60s (clients reconnect with `Last-Event-ID` / `?after`). Events: `log` (`{ id, stream, message, timestamp }`), `status` (`{ status }`), `complete` (`{ status }`), `error` (`{ message }`), plus `heartbeat` comments. The stream closes automatically once the deployment reaches a terminal state. Auth and ownership are checked before the response is returned.
- **Retry (`POST .../retry`):** only terminal deployments (`active | failed | cancelled`) can be retried; the build number is incremented atomically and the deployment is enqueued again.
- **Internal callbacks:** authenticated by constant-time Bearer comparison against `INTERNAL_API_TOKEN`. The builder may not set `active` itself — only the control plane's `complete` endpoint performs the Fly deploy (`deployImageToFly`) and then transitions to `active`. Status transitions are validated with `canTransition`; same-status heartbeats are idempotent.

### 3.9 System

- `GET /api/health` — readiness/liveness; returns `{ status: "ok" }`.
- Internal queue jobs run in `entrypoints/worker.ts` (no public HTTP endpoint); do not expose provider credentials or admin actions over the public API.

## 4. Security and Reliability Requirements (All Endpoints)

- Auth vs authz: session proves identity; every resource access re-checks ownership server-side.
- Output shaping: responses never include Fly tokens, DB URLs, or provider internal IDs.
- Rate limits (proposed): per-user limits on create/start/stop/backup/payment endpoints.
- Idempotency: create, delete, lifecycle, payment, and backup endpoints accept `Idempotency-Key`.
- External calls: bounded timeouts, structured errors mapped to `PROVIDER_ERROR`.
- Queue delivery: workers must tolerate duplicates via idempotency rows.
- Reconciliation: scheduled jobs compare DB machine state with Fly API state.
