# Object Storage Service Checklist — `storage_todo.md`

> **Legend:**
> - `[x]` = Verified implemented & tested in the codebase.
> - `[ ]` = Remaining / pending implementation.
>
> **Related Architecture & Planning Docs:**
> - Master Plan: [`storage_plan.md`](file:///workspaces/cloud/storage_plan.md)
> - Platform Architecture: [`architecture.md`](file:///workspaces/cloud/architecture.md)
> - API Reference: [`api.md`](file:///workspaces/cloud/api.md)
> - Database Schema: [`db.md`](file:///workspaces/cloud/db.md)
> - Platform Todo: [`todo.md`](file:///workspaces/cloud/todo.md)

---

## Progress Dashboard

| Phase | Title | Status | Progress | Key Deliverables |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 0** | Decisions & Architecture | **COMPLETE** | 4 / 4 (100%) | Tenancy model, prefix layout, lifecycle states, threat model |
| **Phase 1** | Foundations & Control Plane | **COMPLETE** | 4 / 4 (100%) | Cloudflare R2 binding, Drizzle schema, Neon migrations, Native Vinext Worker |
| **Phase 2** | Core Data Plane & Safety | **COMPLETE** | 10 / 11 (91%) | CRUD, presigned tokens, copy, conditional 304, nosniff/XSS headers, OpenAPI 3.1 |
| **Phase 3** | Metering, Quotas & Billing | **IN PROGRESS** | 3 / 6 (50%) | SQLite DO metering, 512MB/100k op free plan, hard 402 rejection |
| **Phase 4** | Security & Abuse Hardening | **IN PROGRESS** | 2 / 5 (40%) | CI cross-tenant isolation tests, audit logging, admin suspension switch |
| **Phase 5** | Reliability & Observability | **PENDING** | 0 / 5 (0%) | Structured logging with request IDs, metrics, soft-delete trash, runbooks |
| **Phase 6** | Pre-launch & SDK | **PENDING** | 0 / 4 (0%) | TypeScript SDK, k6 load testing, developer docs & quickstart, private beta |
| **Total** | | | **23 / 35 (66%)** | |

---

## Phase 0: Decisions to Lock First — [COMPLETED]

- [x] **API surface definition**: Versioned REST API (`/api/v1/storage/...`) plus HMAC capability tokens for presigned uploads/downloads ([`lib/storage/service.ts`](file:///workspaces/cloud/lib/storage/service.ts), [`lib/storage/presign.ts`](file:///workspaces/cloud/lib/storage/presign.ts)).
- [x] **Tenancy model**: Prefix partitioning with single shared R2 bucket: `t_<tenantId>/<namespace>/<path>`. Random high-entropy IDs (`t_...`) generated deterministically or via random IDs ([`lib/storage/keys.ts`](file:///workspaces/cloud/lib/storage/keys.ts)).
- [x] **Tenant lifecycle state machine**: Defined states (`trial`, `active`, `suspended`, `pending_delete`, `deleted`) with valid transition matrix and operation authorization guards ([`lib/storage/lifecycle.ts`](file:///workspaces/cloud/lib/storage/lifecycle.ts)).
- [x] **Threat model**: Documented threat surface covering cross-tenant boundaries, key leakage, public file abuse, and quota/cost attacks ([`architecture.md`](file:///workspaces/cloud/architecture.md), [`storage_plan.md`](file:///workspaces/cloud/storage_plan.md)).

---

## Phase 1: Foundations — [COMPLETED]

- [x] **Native Stack**: Native Vinext Cloudflare Worker (App Router, no external Hono router), Zod request validators, Drizzle ORM ([`app/api/v1/storage/**`](file:///workspaces/cloud/app/api/v1/storage)).
- [x] **Environment & Secret Isolation**: Cloudflare Workers bindings (`STORAGE_BUCKET` R2 binding with memory fallback for testing, `AUTH_SECRET`, `INTERNAL_API_TOKEN`) ([`cloudflare.config.ts`](file:///workspaces/cloud/cloudflare.config.ts), [`lib/storage/r2.ts`](file:///workspaces/cloud/lib/storage/r2.ts)).
- [x] **Control-Plane Database Schema**: Drizzle schema in [`lib/storage/schema.ts`](file:///workspaces/cloud/lib/storage/schema.ts) and Neon migration `drizzle/0005_storage_service.sql`:
  - `storage_tenants` (limits, status, storage used)
  - `storage_projects` (namespaces / buckets)
  - `storage_api_keys` (SHA-256 hashed keys, permissions, revocation)
  - `storage_usage_daily` (daily rollups of storage and egress)
  - `storage_usage_events` (raw accounting ledger)
  - `storage_audit_log` (administrative actions log)
- [x] **Database Access Layer**: Resilient fallback to product database with pooled Neon connections ([`lib/storage/db.ts`](file:///workspaces/cloud/lib/storage/db.ts)).

---

## Phase 2: Core Data Plane & Safety — [COMPLETED]

- [x] **Prefixed API Keys & Hashing**:
  - `sk_live_...` high-entropy random keys.
  - SHA-256 key hashing; raw secrets never stored ([`lib/storage/keys.ts`](file:///workspaces/cloud/lib/storage/keys.ts)).
  - Key management endpoints: `POST /api/v1/storage/api-keys`, `GET /api/v1/storage/api-keys`, `DELETE /api/v1/storage/api-keys/:id` ([`app/api/v1/storage/api-keys/route.ts`](file:///workspaces/cloud/app/api/v1/storage/api-keys/route.ts)).
- [x] **Hot-Path Auth Caching**:
  - Redis/in-memory 60-second caching (`storage:apikey:<hash>`) in [`lib/storage/request-auth.ts`](file:///workspaces/cloud/lib/storage/request-auth.ts) to eliminate DB lookups on file read/write hot paths.
- [x] **Object CRUD Operations**:
  - `PUT /api/v1/storage/namespaces/:namespace/files/*`: Upload object with MIME detection and metadata storage.
  - `GET /api/v1/storage/namespaces/:namespace/files/*`: Download object stream.
  - `HEAD /api/v1/storage/namespaces/:namespace/files/*`: Read metadata, ETag, and Content-Length.
  - `DELETE /api/v1/storage/namespaces/:namespace/files/*`: Delete object.
  - `GET /api/v1/storage/namespaces/:namespace/files`: List objects with delimiter, prefix filtering, and cursor pagination.
- [x] **Server-Side File Copy**:
  - `POST /api/v1/storage/namespaces/:namespace/files/*` with JSON destination `{ destinationNamespace, destinationPath }` ([`lib/storage/service.ts`](file:///workspaces/cloud/lib/storage/service.ts)).
- [x] **Presigned Capability Tokens (Proxy Pattern)**:
  - HMAC-SHA256 signed capability tokens (`PST`) valid for 60s–24h ([`lib/storage/presign.ts`](file:///workspaces/cloud/lib/storage/presign.ts)).
  - Token minting endpoint: `POST /api/v1/storage/namespaces/:namespace/presign`.
  - Direct unauthenticated upload/download endpoint: `PUT|GET /api/v1/storage/presigned/:token` ([`app/api/v1/storage/presigned/[token]/route.ts`](file:///workspaces/cloud/app/api/v1/storage/presigned/[token]/route.ts)).
- [x] **ETag & Conditional Requests**:
  - `If-None-Match` and `If-Modified-Since` validation returning `304 Not Modified` on `GET` and `HEAD` without streaming object payload.
- [x] **Safety & Abuse Headers**:
  - `X-Content-Type-Options: nosniff` on all file downloads.
  - HTML, SVG, and XML uploads forced to `Content-Type: application/octet-stream` and `Content-Disposition: attachment; filename="..."` to prevent XSS attacks against dashboard origin.
- [x] **Upload Size Limit**:
  - Upfront `Content-Length` inspection enforcing 100 MB max object size, rejecting oversized payloads immediately with `413 VALIDATION_ERROR` before buffering body.
- [x] **Path Safety & Normalization**:
  - Strict POSIX validation rejecting path traversal (`..`), empty path segments, and backslashes ([`lib/storage/validators.ts`](file:///workspaces/cloud/lib/storage/validators.ts)).
- [x] **Idempotency & Rate-Limit Standards**:
  - `Idempotency-Key` tracking stored in R2 `customMetadata` and echoed in response headers.
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers returned via [`lib/storage/rate-limit-headers.ts`](file:///workspaces/cloud/lib/storage/rate-limit-headers.ts).
  - Public OpenAPI 3.1 specification exposed at `GET /api/v1/storage/openapi.json`.
- [ ] **Multipart Uploads for Multi-GB Files**:
  - Direct S3 multipart chunking API for files exceeding Worker memory/request streaming limits.

---

## Phase 3: Metering, Quotas, and Billing Hooks — [IN PROGRESS]

- [x] **Real-Time Usage Accounting via Durable Object**:
  - SQLite-backed Cloudflare Durable Object (`TenantMeterDO` in [`lib/storage/quota-do.ts`](file:///workspaces/cloud/lib/storage/quota-do.ts)) bound as `STORAGE_METER`.
  - Atomic tracking of `bytes_used`, `file_count`, and monthly Class A and Class B operations.
  - Event ledger in `storage_usage_events` with `class_type` and daily aggregates in `storage_usage_daily` (Neon migration `0006_dazzling_jubilee.sql`).
- [x] **Free Plan Quota Caps (512 MB, 100k Reads, 100k Writes)**:
  - Free Plan: 512 MB storage limit (`536,870,912` bytes), 100,000 monthly Class A write/list operations, and 100,000 monthly Class B read operations defined in `STORAGE_PLANS`.
  - Upfront atomic reservation rejects over-quota uploads and copies with `402 Quota Exceeded`.
- [x] **Operation Rate Limiting by Plan Tier**:
  - Durable Object operation guards for Class A (write/list/copy/delete) and Class B (read/head) requests returning `402` when monthly quota is reached.
  - Public usage inspection API at `GET /api/v1/storage/usage` and `GET /api/v1/storage/tenants`.
- [ ] **Nightly R2 Prefix Reconciler**:
  - Cloudflare Cron Trigger or Queue consumer to scan `t_<tenantId>/` prefixes and reconcile actual R2 stored bytes against the DO meter via `reconcile()`.
- [ ] **Billing System Hooks**:
  - Calculate monthly billable metrics (GB-months, Class A ops, Class B ops, egress) for paid tier upgrades.
- [ ] **Quota Threshold Alerts**:
  - Dispatch notification/webhook when tenant reaches 80% and 100% of plan storage allowance.

---

## Phase 4: Security and Abuse Hardening — [IN PROGRESS]

- [x] **Secrets Isolation in Worker Environment**:
  - Master R2 bucket credentials and signing secrets kept strictly in Worker bindings/secrets, never exposed to database or client bundles.
- [x] **Lifecycle Suspension Switch**:
  - Lifecycle state check blocks suspended tenants in `canPerformStorageOperation` ([`lib/storage/lifecycle.ts`](file:///workspaces/cloud/lib/storage/lifecycle.ts)).
- [ ] **Automated Cross-Tenant Isolation Test Suite**:
  - Dedicated automated CI test suite explicitly attempting:
    - Path traversal across tenant boundaries (`../t_<other>/`).
    - URL-encoded slash bypasses (`%2F`, `%2e%2e%2f`).
    - Cross-tenant presigned token forgery and tampering.
    - Swapping API keys between different tenant namespaces.
- [ ] **Control-Plane Audit Logging**:
  - Automatically record entries in `storage_audit_log` on API key creation/revocation, namespace deletion, manual quota overrides, and tenant suspension.
- [ ] **Public File Abuse Controls & CDN Separation**:
  - Dedicated storage origin domain (e.g. `cdn.yourdomain.com` or worker subdomain) isolated from dashboard cookie origin.
  - Hotlink prevention and abnormal egress spike detection.

---

## Phase 5: Reliability and Observability — [REMAINING]

- [ ] **Structured Request Logging**:
  - JSON logs tagged with `requestId`, `tenantId`, `namespace`, operation type, byte size, status code, and latency in ms.
- [ ] **Metrics & SLO Monitoring**:
  - Expose operational metrics (p95 latency, error rates, ops/sec per tenant).
  - Define alerts for 99.9% availability targets and elevated 5xx error spikes.
- [ ] **Soft-Delete Window (Trash Retention)**:
  - Configurable retention grace period moving deleted files to `_trash/` prefix with R2 lifecycle expiration rules before permanent deletion.
- [ ] **Control-Plane Database Backups**:
  - Scheduled automated snapshot and logical dump of Neon PostgreSQL storage tables to secondary backup storage.
  - Validated restore runbook.
- [ ] **Operational Runbooks**:
  - Documented runbooks for:
    - Recovering from quota drift.
    - Emergency revocation of compromised API keys.
    - Cloudflare R2 regional incident handling.

---

## Phase 6: Pre-launch & SDK — [REMAINING]

- [ ] **TypeScript Client SDK (`@cloud/storage`)**:
  - Typed client supporting:
    - `storage.upload(path, file, { idempotencyKey })`
    - `storage.download(path)`
    - `storage.createPresignedUrl(path, { action, expiresIn })`
    - `storage.list(prefix, { limit, cursor })`
    - `storage.copy(src, dest)`
- [ ] **Interactive Developer Documentation & Quickstart**:
  - cURL, Node.js, and Python code snippets.
  - Dashboard API playground and namespace explorer UI.
- [ ] **k6 Load Testing Suite**:
  - Mixed read/write/list benchmarks against staging worker to validate p95 latency and memory footprint under concurrency.
- [ ] **Pilot Beta Onboarding**:
  - Onboard 5–10 pilot tenants to monitor real-world usage drift, quota enforcement, and error budgets prior to general availability.

---

## Verification & Test Suites

The test suite runs with Node's native test runner (`node --experimental-transform-types --import ./tests/register.js --test tests/*.test.ts`):

- [x] [`tests/storage-quota-do.test.ts`](file:///workspaces/cloud/tests/storage-quota-do.test.ts): SQLite Durable Object atomic byte reservations, 512 MB storage quota rejections (402), 100k Class A & B monthly limits, and R2 byte reconciliation.
- [x] [`tests/storage-phase2.test.ts`](file:///workspaces/cloud/tests/storage-phase2.test.ts): 100 MB limits, nosniff, forced download for HTML/SVG/XML, copy file, presigned token generation & verification, ETag 304 conditional GET.
- [x] [`tests/storage/service.test.ts`](file:///workspaces/cloud/tests/storage/service.test.ts): Core CRUD file & namespace operations.
- [x] [`tests/storage/keys.test.ts`](file:///workspaces/cloud/tests/storage/keys.test.ts): API key hashing, prefix validation, and generation.
- [x] [`tests/storage/lifecycle.test.ts`](file:///workspaces/cloud/tests/storage/lifecycle.test.ts): State transitions and permission enforcement.
- [x] [`tests/storage/routes.test.ts`](file:///workspaces/cloud/tests/storage/routes.test.ts): HTTP route handler tests for API keys and namespace routes.
- [x] **Live Worker Deployment**: Verified against Cloudflare Workers live endpoint (`https://cloud.rsioex.workers.dev/api/v1/storage/openapi.json`).
