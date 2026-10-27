# Builds Architecture

This document describes the Railpack-based build pipeline, environment variables, builder machine configuration, retry and staleness behavior, and operator setup instructions.

## Build Pipeline Overview

1. **User** submits a public GitHub repository URL (or a repository with an explicit Dockerfile).
2. **Control plane** validates the repo via the GitHub API (public check, no PAT required; 404 → missing repo, 403/429 → rate limited, private → reject).
3. A **deployment record** is inserted with status `queued`, `build_number = 1`.
4. A **build-jobs** queue message (`BuildJobPayload`) is enqueued.
5. **Queue worker** (`entrypoints/worker.ts`) runs `processDeployJob`:
   - Creates the deployment's Fly app (idempotent, `ensureDeploymentFlyApp`) and persists `fly_app_id` **before** the build starts, so the app-scoped registry namespace (`registry.fly.io/<app>:<tag>`) exists when the builder pushes — Fly's registry rejects repositories that do not match a real app.
   - Calls `ensureBuilderAwake()` which best-effort starts the Fly builder machine via `startFlyMachine` and then polls `GET /health` up to 60s (2s interval).
   - On success, `dispatchBuild()` POSTs to `{BUILDER_URL}/builds` with Bearer `BUILDER_API_TOKEN`, 20s timeout.
   - If dispatch throws, the consumer retries based on `message.attempts`; after `BUILD_MAX_ATTEMPTS` the deployment status is marked `failed`.
   - On success the deployment status is advanced to `preparing`, `building`, `pushing`, `deploying`, then `active` after the builder reports completion via the internal `complete` endpoint.
6. **Builder** (`builder/server.mjs`) runs on a shared Fly machine (4 GB RAM, see `fly.toml`). It receives the build job, clones the repo, detects the build strategy, runs `railpack prepare`, then builds the image via BuildKit (using the Railpack BuildKit frontend) or plain `docker buildx build --push`. The builder streams live log lines via EventSource back to the control plane (`/api/v1/deployments/:id/logs`), polls deployment status every 60s (heartbeat), and exits with `process.exit(0)` when idle for the configured grace period (`BUILD_IDLE_TIMEOUT_MS`, default 600000 ms / 10 min).
7. The **control plane** receives builder callbacks:
   - `POST /api/v1/internal/deployments/:id/logs` — appends log lines to the deployment.
   - `POST /api/v1/internal/deployments/:id/status` — idempotent status refresh (same-status updates refresh `updatedAt`).
   - `POST /api/v1/internal/deployments/:id/complete` — trusted internal endpoint: advances to `deploying`, calls `deployImageToFly` (creates/app updates Fly app + machine with PORT env, allocates shared IPv4 if needed), then sets status `active`.

## Environment Variables

### Control-plane / Cloudflare Workers (via `cloudflare.config.ts`)

These are bound as **secrets** (`bindings.secret()`) in the Workers configuration:

| Variable | Meaning |
| --- | --- |
| `BUILDER_URL` | URL of the builder HTTP service, e.g. `https://builder.<app>.fly.dev` |
| `BUILDER_API_TOKEN` | Bearer token authenticating to `/builds` (used in `Authorization` header). |
| `BUILDER_APP_NAME` | Fly app name for the builder instance (used with `startFlyMachine`). |
| `BUILDER_MACHINE_ID` | Fly machine ID of the builder (used with `startFlyMachine`). |
| `INTERNAL_API_TOKEN` | Constant-time compared against the `Authorization` header on internal routes. |
| `CONTROL_PLANE_URL` | Base URL for internal callback endpoints. |
| `OCI_REGISTRY` | Registry host for deployment image refs: `${OCI_REGISTRY}/<app>:b${buildNumber}` where `<app>` is the deployment's Fly app (`dep-<deploymentId>` truncated, see `deploymentAppName`). |
| `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` | Basic auth credentials written to `~/.docker/config.json` by `ensureRegistryAuth` (used if `BUILDKIT_HOST` is not set). |
| `BUILD_IDLE_TIMEOUT_MS` | Idle grace period before builder exits (default: `600000` ms = 10 min). |
| `BUILD_MAX_ATTEMPTS` | Max dispatch attempts before marking deployment failed (default: `3`). |
| `BUILD_WORKSPACE_DIR` | Working directory for git clones on the builder (default: `/workspace`). |
| `BUILD_DEFAULT_INTERNAL_PORT` | Default internal port if railpack/Dockerfile does not specify one (default: `8080`). |
| `GITHUB_API_TOKEN` | Optional; server-side GitHub API calls when repo checks need auth. |
| `BUILD_MAX_DURATION_MS` | Max wall-clock time a build is allowed to run on the builder. |

### Builder machine (inside `builder/server.mjs` runtime process)

| Variable | Meaning |
| --- | --- |
| `PORT` | Internal port the builder listens on (default: `8080`). |
| `BUILD_STRATEGY` | `auto` (default) — Dockerfile if present, else Railpack; `railpack` — always use Railpack even when a Dockerfile exists (e.g. Nx-generated Dockerfiles that assume a prebuilt `dist/`); `dockerfile` — require a Dockerfile, fail otherwise. |
| `RAILPACK_BIN` | Path to the railpack binary (used in testing; production uses BuildKit front-end). |
| `BUILDKIT_HOST` | Unix socket for rootless buildkitd, e.g. `unix:///home/builder/.run/buildkit/buildkitd.sock`. |
| `RAILPACK_FRONTEND_IMAGE` | `ghcr.io/railwayapp/railpack-frontend:latest` (used as `BUILDKIT_SYNTAX`). |
| `GITHUB_TOKEN` | Optional GitHub PAT for private repo checks (not required for public repos). |
| `ENABLE_BUILDKITD` | When `0`, the builder expects an external `BUILDKIT_HOST` pointing to an existing buildkitd instance; when `1` the entrypoint starts rootless buildkitd. |
| `BUILD_MAX_DURATION_MS` | Max wall-clock time a build may run before the builder kills it. |

## Builder Runtime Details

### Build process on the shared Fly machine

1. **Clone** — git clone `--depth 1 --single-branch --branch=<branch>` (branch resolved via `detectStrategy` / `resolveGitHubHeadSha`).
2. **Strategy detection** — `findDockerfile()` (case-insensitive `dockerfile`/`containerfile` only); if present → Dockerfile strategy; if absent → railpack strategy. `BUILD_STRATEGY=railpack` forces Railpack, `BUILD_STRATEGY=dockerfile` requires a Dockerfile.
3. **Railpack build** (BuildKit, BuildKit frontend):
   - Run `railpack prepare <dir> --plan-out railpack-plan.json --info-out railpack-info.json`.
   - `classifyPrepareExit` treats exit `0` as success, `75`/null/undefined as transient retry, anything else as permanent failure.
   - On success, run `docker buildx build --build-arg BUILDKIT_SYNTAX=${RAILPACK_FRONTEND_IMAGE} -f railpack-plan.json --push -t <imageRef> <dir>` OR via `buildctl` when `BUILDKIT_HOST` is set.
   - The image tag is `${OCI_REGISTRY}/<app>:b${buildNumber}` (lowercase), where `<app>` is the deployment's Fly app (`dep-<deploymentId>` truncated). The app is created by the control plane before the build is dispatched.
4. **Plain Dockerfile build** (when no railpack plan):
   - Run `docker buildx build --push -t <imageRef> -f <dockerfile> <context>`.
5. **Registry auth** — `ensureRegistryAuth` writes `~/.docker/config.json` with the registry username/password (if using Dockerfile build without BuildKit). With BuildKit, the registry creds are passed as build args/secrets via the frontend; customer code never sees them.
6. **Log streaming** — lines from railpack prepare/stdout/stderr are emitted as SSE events (`event: log`, `data: [...]`); the builder heartbeat (`event: heartbeat`) updates the deployment `updatedAt` every 60s.
7. **Idle handling** — after the build completes, the builder waits `BUILD_IDLE_TIMEOUT_MS` (default 10 min) with no new jobs; if no new job arrives, `process.exit(0)`.
8. **Crash / signal handling** — SIGTERM/SIGINT trigger a graceful exit: close EventSource, flush buffered logs, `process.exit(0)`.
9. **/health endpoint** — `GET /health` returns `{ status: "ok" }`. Used by `ensureBuilderAwake()` to determine whether the builder needs restarting.
10. **/builds endpoint** — `POST /builds` validates a single job object, spawns the detached build child process, returns `{ jobId }`. Single-active-build guard: only one build runs at a time. On fatal error, the builder exits(1) and the queue consumer marks the deployment failed after max attempts.

### Rootless BuildKit setup (Fly machine)

The `builder/entrypoint.sh` starts a rootless buildkitd:

```
buildkitd --oci-worker-no-process-sandbox \
  --addr unix:///home/builder/.run/buildkit/buildkitd.sock \
  --oci-worker-no-process-sandbox
```

It then waits for `buildctl debug workers` to become available (a few seconds). The `ENABLE_BUILDKITD` env var, when set to `0`, skips this startup and expects an external `BUILDKIT_HOST` to be reachable. This is the documented fallback for environments where user namespaces or the `--oci-worker-no-process-sandbox` flag are not available.

### Retry and staleness behavior

- **Dispatch retry** (queue consumer): the worker message has an `attempts` counter (incremented automatically by Cloudflare KV). If dispatch throws, the consumer re-queues the job; after `BUILD_MAX_ATTEMPTS` (default 3) the deployment status is marked `failed`.
- **Staleness watchdog** (scheduled `*/5 * * * *`): `recoverStaleDeployments()` scans all in-flight deployments (status != terminal); if `updatedAt` is older than `STALE_BUILD_AFTER_MS` (default 600000 ms = 10 min), the deployment is marked `failed` and the builder process is considered stuck. This ensures the system recovers from builder crashes or hangs.
- **Builder heartbeat**: every 60s while a build is in progress, the builder sends a POST to the internal `/status` endpoint with the current status. If the status is already terminal, the heartbeat is a no-op. This keeps `updatedAt` fresh and prevents the staleness watchdog from firing on long-running builds.

## Operator Checklist (one-time setup)

1. **Provision a shared Fly builder machine** (4 GB RAM, shared CPU, any region; see `fly.toml` for the app config, default region `FLY_DEFAULT_REGION ?? "sin"`).
2. **Start the builder** — either run `builder/server.mjs` directly, or configure Fly to auto-start the Docker/Node process on machine creation.
3. **Set Cloudflare secret bindings** (see `cloudflare.config.ts`): `BUILDER_URL`, `BUILDER_API_TOKEN`, `BUILDER_APP_NAME`, `BUILDER_MACHINE_ID`, `INTERNAL_API_TOKEN`, `CONTROL_PLANE_URL`, `OCI_REGISTRY`, `OCI_REGISTRY_USERNAME`, `OCI_REGISTRY_PASSWORD`, `BUILD_IDLE_TIMEOUT_MS`, `BUILD_MAX_ATTEMPTS`, `BUILD_WORKSPACE_DIR`, `BUILD_DEFAULT_INTERNAL_PORT`, optionally `GITHUB_API_TOKEN`, `BUILD_MAX_DURATION_MS`, `BUILD_STRATEGY`.
4. **Deploy the builder Docker image** — `builder/Dockerfile` (node:22-bookworm-slim) with `builder/entrypoint.sh`; `fly.toml` ships the app config (build path, `http_service`, VM sizing, autostop off). Push to a registry reachable from the Fly network.
5. **Verify health** — `curl /health` on the builder URL should return `{"status":"ok"}`.
6. **Test a deployment** — create a GitHub deployment from a public repo; watch the live log stream and the status transition through the pipeline.
7. **Monitor staleness** — the scheduled `*/5 * * * *` cron triggers `recoverStaleDeployments`; verify it fires after 10 min of inactivity.

## Troubleshooting

- **Builder can't start machine**: check `BUILDER_APP_NAME` / `BUILDER_MACHINE_ID` are correct; ensure the API token has machine start permission.
- **Build fails at `railpack prepare`**: exit code 1 means no provider or start command detected in the repo; exit code 75 is transient (network/Mise download) → retry; other codes are permanent.
- **Image push fails**: ensure `OCI_REGISTRY` / `OCI_REGISTRY_USERNAME` / `OCI_REGISTRY_PASSWORD` are correct; the builder writes `~/.docker/config.json` and uses it for `docker login` (if `BUILDKIT_HOST` unset) or passes them as build args (if BuildKit). Fly's registry only accepts repositories matching a real app: if the target app was deleted out-of-band, the push 404s — delete/recreate the deployment so the control plane re-creates the app before the next build.
- **SSE stream closes prematurely**: the server closes the stream 60s after the last event; clients should use `Last-Event-ID` to resume.
- **Deployment stuck at `preparing`**: the staleness watchdog may have fired → check `updatedAt` age. Manually retry via the UI or `POST /retry`.
- **No logs appear**: the builder heartbeats every 60s; if no log lines are emitted for >60s the status stays `preparing` until the build finishes.

## Related Docs

- [`api.md`](./api.md) — full API reference for deployment endpoints.
- [`db.md`](./db.md) — database schema and state transitions.
- [`todo.md`](./todo.md) — engineering checklist with deployment items.
- [`prd.md`](./prd.md) — product requirements.
- [`architecture.md`](./architecture.md) — overall system architecture.