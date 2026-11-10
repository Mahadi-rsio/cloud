# Cloudflare Worker Object Storage — Threat Model

This document outlines the threat landscape, security boundaries, and defensive countermeasures for the multi-tenant object storage platform built on Cloudflare Workers and Cloudflare R2.

---

## 1. Security Architecture & Trust Boundaries

```
[ Client / API Caller ]
         │ (HTTPS + Bearer API Key / Session)
         ▼
[ Cloudflare Worker Edge (Vinext) ]
    ├─ Authentication & Scopes (`lib/storage/auth.ts`)
    ├─ Path Sanitization & Traversal Blocker (`lib/storage/keys.ts`)
    └─ Tenancy Key Layout Engine (`formatObjectKey`)
         │
         ├──► [ Control Plane Database (libSQL) ]
         │      └─ Tenants, Namespaces, Hashed API Keys, Usage & Audit Logs
         │
         └──► [ Cloudflare R2 Bucket ]
                └─ Object Key: `t_<tenantId>/<namespace>/<normalizedPath>`
```

---

## 2. Threat Analysis & Mitigations

### Threat 1: Cross-Tenant Access & Data Leakage
- **Threat**: A malicious tenant attempts to read, overwrite, or delete objects belonging to another tenant or another project.
- **Countermeasure**:
  - Objects are stored under strict path isolation: `t_<tenantId>/<namespace>/<path>`.
  - The `tenantId` is extracted solely from the authenticated API key or verified session token — never trusted from caller-supplied headers or body parameters.
  - Path parameters are strictly bound to the authenticated tenant's UUID/ULID.

### Threat 2: Path Traversal & Namespace Escape
- **Threat**: Attackers supply `../`, `..\\`, encoded `%2e%2e`, `%00`, or absolute `/` paths to escape their namespace or manipulate root objects.
- **Countermeasure**:
  - `validatePath` rejects any path containing relative segments (`..`, `.`), encoded characters (`%2e`, `%00`, `%5c`), leading slashes, or non-printable ASCII characters.
  - R2 keys are formatted via the deterministic `formatObjectKey` function, throwing a 400 Validation Error before any storage provider call.

### Threat 3: API Key Leakage & Compromise
- **Threat**: Plaintext API keys leaked through git repositories, logs, or database compromises.
- **Countermeasure**:
  - Plaintext keys (`sk_live_...`) are returned exactly once upon creation.
  - The database only stores a non-reversible SHA-256 hash (`keyHash`) and an 8-character prefix (`prefix`) for safe UI identification.
  - Constant-time verification (`timingSafeEqual`) prevents timing attack side-channels.
  - Instant revocation endpoint (`DELETE /api/v1/storage/api-keys/:id`) invalidates keys immediately.

### Threat 4: Cost Attacks & Denial-of-Wallet (Large Uploads & Egress Floods)
- **Threat**: Malicious or runaway callers upload massive multi-gigabyte files or initiate high-concurrency downloads to incur unbounded egress/storage fees.
- **Countermeasure**:
  - Tenant quotas: Default limits (`storageLimitBytes` = 10 GB, `bandwidthLimitBytes` = 50 GB, `egressRateLimitMbps` = 100 Mbps).
  - Lifecycle state machine: Trial accounts are automatically restricted after 7 days (`isTrialExpired` blocks writes and deletes with HTTP 402 Payment Required). Suspended accounts block all I/O immediately with HTTP 403.
  - Granular usage tracking logs ingress/egress bytes and operations to `usage_daily` and `usage_events`.

### Threat 5: Malicious File Uploads (XSS / MIME Confusion)
- **Threat**: An attacker uploads HTML or SVG files containing scripts to execute in another user's browser origin.
- **Countermeasure**:
  - Downloads default to binary octet stream or attachment disposition unless verified.
  - User assets are served from isolated namespace paths without browser cookie elevation.

---

## 3. Summary of Enforced Controls

| Component | Control | Enforcement Point |
|---|---|---|
| **API Keys** | Prefixed (`sk_live_...`), SHA-256 hashed | `lib/storage/auth.ts` |
| **Tenancy Isolation** | `t_<tenantId>/<namespace>/<path>` | `lib/storage/keys.ts` |
| **Path Traversal** | Rejects `..`, `%2e%2e`, `\0`, `\` | `lib/storage/keys.ts` |
| **Tenant Lifecycle** | `trial → active → suspended → pending_delete → deleted` | `lib/storage/lifecycle.ts` |
| **Storage Operations** | Scope verification (`storage:read`, `storage:write`, `storage:delete`) | `app/api/v1/storage/...` |
