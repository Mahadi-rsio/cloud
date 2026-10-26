# API Documentation — Cloud Hosting Platform

> **Status:** This document describes both the **current** API surface (implemented and verified) and the **proposed** target API. Endpoints marked **[Implemented]** exist today; endpoints marked **[Proposed]** do not yet exist.
> **Related documents:** [`prd.md`](./prd.md), [`architecture.md`](./architecture.md), [`db.md`](./db.md), [`plan.md`](./plan.md), [`todo.md`](./todo.md)

## 1. Conventions

### 1.1 Base URL

- Current: all client calls go through the axios instance in `lib/api.ts` with `baseURL: "/api/auth"`.
- Proposed: versioned namespace `/api/v1/` for product resources, keeping `/api/auth/*` for Better Auth.

### 1.2 Authentication

- Current: Better Auth session cookie (`better-auth` cookie prefix, `lib/auth/index.ts`). Server reads sessions via `getSession()` (`lib/auth/session.ts`) using `auth.api.getSession`.
- Proposed: the same session mechanism authorizes product endpoints. `GET /api/auth/get-session` is the client-side way to refresh session state.

### 1.3 Response envelope

- Current: Better Auth endpoints return their own JSON shapes; the client (`lib/errors.ts`) reads `error.response.data.message` (string or array of `{ message }`).
- Proposed: standardize on one envelope for new endpoints:

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

### 1.4 Error codes (proposed)

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
- Proposed: every request body is validated server-side with Zod; shared schemas live in `lib/validators/`.

### 1.6 Pagination / filtering / sorting (proposed)

- Collections use `?cursor=<opaque>` for keyset pagination, `?filter[status]=running`, and `?sort=-createdAt`.
- Response shape: `data.items`, `data.nextCursor`.

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
- **Note:** no application/billing cleanup exists today because those resources are not yet implemented.

### 2.6 `GET /api/auth/get-session` — [Implemented]

- **Purpose:** return the current session (used implicitly by `getSession()` and the axios client where needed).
- **Auth:** cookie.
- **Success:** 200 with `{ session: {...} | null }`.

### 2.7 Other Better Auth endpoints — [Implemented via catch-all]

The `[...all]` catch-all also serves any other Better Auth route (`/callback/*`, `/error`, etc.). These are provider-managed and not documented individually.

## 3. Proposed API — Not Implemented

All endpoints below are **[Proposed]** and currently return 404. File paths are proposed locations.

### 3.1 Applications

| Endpoint | Auth | Body / Query | Success |
| --- | --- | --- | --- |
| `GET /api/v1/applications` | session | `?cursor&filter[status]&sort` | `data.items`, `data.nextCursor` |
| `POST /api/v1/applications` | session | `{ name, planId?, region?, runtime? }` | 201 `data.app` |
| `GET /api/v1/applications/{id}` | session + owner | — | `data.app` with machine/volume summary |
| `PATCH /api/v1/applications/{id}` | session + owner | `{ name?, runtime?, region? }` | `data.app` |
| `DELETE /api/v1/applications/{id}` | session + owner | — | `data.operationId` (async) |

- **Ownership:** every handler resolves the application row, asserts `app.userId === session.user.id`; otherwise 403.
- **Zod:** `createApplicationSchema` (name 2–64 chars, region enum, planId UUID), `updateApplicationSchema`.
- **Idempotency:** `POST /api/v1/applications` honors an `Idempotency-Key` header; duplicates return the original resource.
- **Queue interaction:** create/delete enqueue provisioning/cleanup jobs.

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
