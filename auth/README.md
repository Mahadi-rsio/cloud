# Managed Better Auth

Neon-style managed auth over our own libSQL/sqlite fleet. Each Auth Project gets:

- a dedicated **libSQL namespace** (`{slug}_{id}.cloudisy.top`),
- the canonical Better Auth SQLite schema applied at provisioning time,
- a linked **Databases** row tagged `source: "auth"` (inspectable in Studio),
- a **publishable key** used by client apps to route through the shared runtime.

## Layout

| Path | Purpose |
|---|---|
| `schema/better-auth-sqlite.sql` | Canonical SQLite DDL (single source of truth) |
| `../lib/auth-projects/service.ts` | Provision / list / get / soft-delete |
| `../lib/auth-projects/schema-runner.ts` | Replays the DDL into a new namespace |
| `../lib/auth-projects/runtime.ts` | Per-project `betterAuth()` factory + instance cache |
| `../app/api/v1/auth/projects/...` | Control-plane API |
| `../app/api/auth-runtime/[...all]` | Shared runtime proxy |
| `../app/(app)/auth/page.tsx` | Dashboard |

## Environment

```env
LIBSQL_ADMIN_URL=https://libsql-database-service.fly.dev:8443
LIBSQL_ADMIN_AUTH_KEY=
LIBSQL_BASE_DOMAIN=cloudisy.top
# Optional: comma-separated browser origins allowed to call the runtime.
AUTH_RUNTIME_TRUSTED_ORIGINS=https://app.example.com
```

## Provisioning

`POST /api/v1/auth/projects` with `{ "name": "My App" }`:

1. `generateNamespace()` + `generateKeypair()`
2. `createSqldNamespace(namespace, publicKey)`
3. mint an RW `defaultToken`
4. `applyAuthSchema(httpUrl, defaultToken)` (imports the SQL via `?raw`)
5. insert the linked `databases` row (`source = "auth"`)
6. insert the `auth_projects` row with `publishableKey` + `authSecret`

Failure after step 2 removes the namespace and any partial database row.

## Client usage

```ts
import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: "https://app.cloudisy.top/api/auth-runtime",
  fetchOptions: {
    headers: { "x-publishable-key": process.env.NEXT_PUBLIC_AUTH_PUBLISHABLE_KEY! },
    credentials: "include",
  },
});

await authClient.signUp.email({ name, email, password });
await authClient.signIn.email({ email, password });
```

The runtime resolves the project by `x-publishable-key`, builds (and caches) a
Better Auth instance against `project.httpUrl`, and forwards the request.
Cookies are `SameSite=None; Secure` on HTTPS so cross-site clients work.

## Security notes

- `authSecret`, `privateKey`, and `defaultToken` are **never** returned by the
  list/detail API; only the internal runtime lookup reads them.
- The publishable key is public by design — it identifies the project, it does
  not grant database access.
- `trustedOrigins` reflects the request `Origin` unless
  `AUTH_RUNTIME_TRUSTED_ORIGINS` is set. Tighten this for production.
- Delete removes the sqld namespace and soft-deletes both rows
  (`status = 'deleted'`, `deletedAt` set).

## Verification

```bash
npx tsc --noEmit
npx vitest run
npm run build
```
