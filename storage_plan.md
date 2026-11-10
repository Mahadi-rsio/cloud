Here's a plan to build this as a production-grade service, in phases. A solo developer could reach a private beta in about 6 to 8 weeks.

## Phase 0: Decisions to lock first (2-3 days) — [COMPLETED]
- **API surface:** start with a versioned REST API (`/v1/...`) plus presigned upload and download URLs. Add an S3-compatible layer later only if customers ask for it.
- **Tenancy model:** one shared bucket per environment, with the key layout `t_<tenantId>/<projectId>/<path>`. Generate tenant IDs as random IDs (ULID or UUID), not sequential numbers.
- **Tenant lifecycle states:** `trial → active → suspended → pending_delete → deleted`. Your 7-day trial then delete plan becomes a scheduled purge job instead of a manual cleanup.
- **Threat model:** write down one page covering cross-tenant access, key leakage, abuse of public files, and cost attacks.

## Phase 1: Foundations (week 1) — [COMPLETED]
- **Stack:** TypeScript, Native Vinext Cloudflare Worker (App Router / Worker fetch handlers, no external Hono router needed), Zod for validation, Drizzle with the libsql driver (matching our existing DB), and Vitest for tests.
- **Environments:** dev, staging, and prod, each with its own R2 bucket, API tokens, and Worker. Never share credentials across environments.
- **Infrastructure as code:** Wrangler config plus Terraform for the Cloudflare resources. CI/CD on GitHub Actions: lint, typecheck, test, deploy staging, manual promote to prod.
- **Control-plane schema:** `tenants`, `projects`, `api_keys`, `usage_daily`, `usage_events`, and `audit_log`.

## Phase 2: Core data plane (weeks 2-3) — [COMPLETED]
- **API keys:** use a prefixed format (`sk_live_...`) with high entropy and store only the hash. Support multiple keys per tenant, rotation, and revocation.
- **Auth hot path:** cache key lookups in KV or the Cache API with a 30-60 second TTL. That way a slow or down Fly DB doesn't break every request.
- **Object operations:** put, get, head, delete, list with cursor pagination, copy, and multipart for large files. Use presigned URLs for uploads over a few MB.
- **Safety rules:**
  - Normalize keys and reject traversal.
  - Enforce max object size (100 MB) and an allowed-content policy.
  - Set a safe `Content-Disposition` and `X-Content-Type-Options`.
  - Serve user-uploaded public content from a separate domain, so uploaded HTML can't attack your dashboard origin.
- **API standards:** OpenAPI spec (`/api/v1/storage/openapi.json`), RFC 7807 error format, idempotency keys on writes, ETag and conditional requests, and rate-limit headers.

## Phase 3: Metering, quotas, and billing hooks (week 4) — [IN PROGRESS]
- **Durable Object Metering:** SQLite-backed Cloudflare Durable Object (`TenantMeterDO`) providing atomic, single-threaded byte reservations and real-time Class A / Class B request counting.
- **Free Plan Quotas:** 512 MB storage limit (`536,870,912` bytes), 100,000 monthly Class A write/list operations, and 100,000 monthly Class B read operations.
- **Hard Quota Enforcement:** Upfront preflight checks reject oversized uploads and over-limit writes with HTTP `402 Quota Exceeded`.
- **Usage tracking & ledger:** Neon PostgreSQL tables (`storage_usage_events`, `storage_usage_daily`, `storage_tenants`) track reconciled metrics with `class_type` classifications (migration `0006`).
- **Live APIs:** `GET /api/v1/storage/usage` and `GET /api/v1/storage/tenants` inspect usage and limits.
- **Nightly reconciliation (remaining):** Cloudflare Cron Trigger / Queue consumer to scan `t_<tenantId>/` prefixes and reconcile actual R2 stored bytes against the DO meter via `meter.reconcile()`.

## Phase 4: Security and abuse hardening (week 5)
- **Isolation tests:** write automated tests that try to cross tenant boundaries (path tricks, encoded slashes, presigned URL reuse, key swapping). Run them in CI on every deploy.
- **Secrets:** keep the master R2 credentials only in the Worker's secrets, never in the DB or the client.
- **Audit log:** record key creation and revocation, plan changes, and deletions.
- **Abuse controls:** a terms-of-use page, a takedown process, a per-tenant suspend switch, and public-file hotlink and bandwidth monitoring.

## Phase 5: Reliability and observability (week 6)
- **Logging and monitoring:** structured logs with a request ID and tenant ID, metrics (latency, error rate, bytes, ops per tenant), alerts, and a status page. Define SLOs, for example 99.9% availability and p95 latency targets.
- **Control-plane backups:** back up your libSQL DB on Fly regularly (volume snapshots plus a logical dump to a separate R2 bucket) and test restores. Losing it doesn't lose files, but you'd lose tenant-to-usage mapping and API keys.
- **Delete protection:** decide whether to add a soft-delete window (move to a `_trash/` prefix with a lifecycle rule), since users will delete things by accident.
- **Runbooks:** for quota-drift fixes, leaked keys, and R2 or Fly outages.

## Phase 6: Pre-launch (weeks 7-8)
- **Load testing:** run k6 against staging with realistic mixed traffic.
- **Developer experience:** publish docs, a generated TypeScript SDK, and a quickstart.
- **Beta:** onboard 5 to 10 friendly tenants, watch usage drift and cost per tenant, and fix issues. Then open signups with trial caps.

**Biggest risks:** a cross-tenant leak (mitigated by the isolation tests) and cost abuse on the free trial (mitigated by hard caps and rate limits). I'd put most of the early effort there.

