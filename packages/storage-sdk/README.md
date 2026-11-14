# `@cloudisy/storage`

Official zero-dependency TypeScript SDK for the Cloud Object Storage API (`/api/v1/storage`). Works in Node.js 18+, Cloudflare Workers, Deno, Bun, and modern browsers using the standard `fetch` API.

## Installation

```bash
npm install @cloudisy/storage
# or
pnpm add @cloudisy/storage
# or
yarn add @cloudisy/storage
# or
bun add @cloudisy/storage
```

## Quickstart

```ts
import { createStorageClient } from "@cloudisy/storage";

const client = createStorageClient({
  baseUrl: "https://cloud.rsioex.workers.dev",
  apiKey: process.env.CLOUD_STORAGE_API_KEY,
  namespace: "my-bucket", // optional default namespace
});

// Upload a file
await client.upload("photos/banner.png", fileBuffer, {
  contentType: "image/png",
  idempotencyKey: "banner-v1",
  metadata: { author: "alice" },
});

// Download a file
const res = await client.download("photos/banner.png");
const bytes = await res.bytes();

// List files (or iterate all pages automatically)
const page = await client.list("photos/", { limit: 50 });
for await (const obj of client.listAll("photos/")) {
  console.log(obj.path, obj.size);
}
```

## Configuration

`createStorageClient(options)` (or `new StorageClient(options)`) accepts `StorageClientOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `baseUrl` | `string` | `""` | Base URL of your Cloud Storage service (e.g. `"https://cloud.rsioex.workers.dev"`). May optionally include `/api/v1/storage`. Omit or pass `""` for relative requests in a browser. |
| `apiKey` | `string` | — | Storage API key (`sk_live_...` or `sk_test_...`). Optional when using browser session cookies. |
| `authHeader` | `"x-api-key" \| "bearer"` | `"x-api-key"` | Header used to transmit `apiKey` (`x-api-key` or `Authorization: Bearer <key>`). |
| `namespace` | `string` | — | Default namespace used by top-level object methods (`client.upload`, `client.download`, etc.). |
| `timeoutMs` | `number` | — | Default request timeout in milliseconds. |
| `headers` | `Record<string, string>` | — | Extra headers merged into every authenticated request. |
| `fetch` | `typeof globalThis.fetch` | `globalThis.fetch` | Custom `fetch` implementation for testing or custom runtimes. |

### Browser / Session Cookie Usage

When running in a browser on the same origin (e.g. inside the Cloud dashboard), omit `baseUrl` and `apiKey`:

```ts
const client = createStorageClient({
  namespace: "assets",
});
```

## Working with Namespaces

You can either set a default `namespace` on `createStorageClient(...)` or create a scoped `NamespaceClient` with `client.namespace(name)`:

```ts
const assets = client.namespace("assets");
const backups = client.namespace("backups");

await assets.upload("logo.svg", "<svg/>", { contentType: "image/svg+xml" });

// Cross-namespace copy
await assets.copy("logo.svg", "logo-backup.svg", {
  destinationNamespace: "backups",
});
```

## Object Operations

### Upload

Supports `Blob`, `ArrayBuffer`, `ArrayBufferView` (`Uint8Array`, Node `Buffer`), `string`, and `ReadableStream<Uint8Array>` (max 100 MB per object).

```ts
const result = await client.upload("reports/q1.json", JSON.stringify({ ok: true }), {
  contentType: "application/json",
  cacheControl: "public, max-age=3600",
  idempotencyKey: "q1-report-2026",
  metadata: {
    department: "finance",
    reviewed: "true",
  },
});

console.log(result.etag, result.size, result.uploadedAt);
```

When uploading a `ReadableStream<Uint8Array>`, provide `contentLength` if known:

```ts
await client.upload("videos/clip.mp4", stream, {
  contentType: "video/mp4",
  contentLength: fileSize,
});
```

### Download

`download(path, options?)` returns a `DownloadResult` with helper readers and response metadata:

```ts
const file = await client.download("reports/q1.json");
const data = await file.json<{ ok: boolean }>();
// Also available: file.bytes(), file.text(), file.arrayBuffer(), file.blob(), file.body
```

#### Byte Ranges & Conditional GET

```ts
// Partial byte range (HTTP 206)
const chunk = await client.download("videos/clip.mp4", {
  range: { start: 0, end: 1023 }, // or "bytes=0-1023"
});

// Conditional GET (returns status: 304 and notModified: true when unchanged)
const cached = await client.download("reports/q1.json", {
  ifNoneMatch: file.etag ?? undefined,
});
if (cached.notModified) {
  console.log("Use cached copy");
}

// Force Content-Disposition: attachment
const attachment = await client.download("reports/q1.json", {
  download: true,
});
```

### Head & Exists

```ts
const meta = await client.head("reports/q1.json");
console.log(meta.contentLength, meta.contentType, meta.etag);

const exists = await client.exists("reports/q1.json"); // boolean (false on 404)
```

### List & Auto-Pagination

```ts
// Single page
const page = await client.list({
  prefix: "photos/",
  delimiter: "/",
  limit: 100,
});
console.log(page.objects, page.prefixes, page.cursor, page.truncated);

// Shorthand with prefix
const firstPage = await client.list("photos/", { limit: 25 });

// Iterate across all pages automatically
for await (const obj of client.listAll("photos/")) {
  console.log(obj.path, obj.size, obj.uploaded);
}
```

### Copy & Delete

```ts
await client.copy("photos/banner.png", "archive/banner.png");

// Copy into another namespace
await client.copy("photos/banner.png", "banner.png", {
  destinationNamespace: "public-cdn",
});

const deleted = await client.delete("photos/banner.png");
console.log(deleted.existed);
```

## Presigned URLs

Create short-lived presigned URLs on your server and let browsers or workers upload/download directly without exposing your API key:

```ts
// Server-side: create a presigned upload URL (expiresIn: 60..86400 seconds)
const presigned = await client.createPresignedUrl("uploads/avatar.jpg", {
  action: "write", // or method: "PUT"
  expiresIn: 600,
  contentType: "image/jpeg",
  maxSizeBytes: 5 * 1024 * 1024,
  singleUse: true,
});

// Client-side: upload directly using the presigned URL or token (no API key sent)
const unauthenticatedClient = createStorageClient({
  baseUrl: "https://cloud.rsioex.workers.dev",
});

await unauthenticatedClient.presigned.upload(presigned.url, avatarFile, {
  contentType: "image/jpeg",
});

// Presigned download
const downloadLink = await client.createPresignedUrl("uploads/avatar.jpg", {
  action: "read", // or method: "GET"
  expiresIn: 300,
});
const downloaded = await unauthenticatedClient.presigned.download(downloadLink.url);
```

## Namespace, API Key & Tenant Management

```ts
// Tenant & usage metering
const { tenant, usage } = await client.getTenant();
const metrics = await client.getUsage();
console.log(metrics.limits.storageLimitBytes, metrics.usage.usedBytes);

// Namespaces
const namespaces = await client.namespaces.list();
const created = await client.namespaces.create("logs");
const details = await client.namespaces.get("logs"); // includes objectCount & totalBytes
await client.namespaces.delete("logs");

// Scoped API keys
const keys = await client.apiKeys.list();
const { apiKey, secretKey } = await client.apiKeys.create({
  name: "ci-uploader",
  environment: "live",
  scopes: ["storage:write", "storage:read"],
  expiresInDays: 30,
});
// Save secretKey securely — it is only returned once
await client.apiKeys.revoke(apiKey.id);
```

## Error Handling, Rate Limits & Cancellation

All non-2xx API responses (except `304 Not Modified`) throw `StorageApiError`:

```ts
import { StorageApiError } from "@cloudisy/storage";

try {
  await client.download("missing.txt");
} catch (error) {
  if (error instanceof StorageApiError) {
    console.error(error.status, error.code, error.message, error.details);
    if (error.status === 429 && error.rateLimit) {
      console.log("Retry after (s):", error.rateLimit.retryAfterSeconds);
    }
  }
}
```

Every method accepts `RequestOptions` (`signal`, `timeoutMs`, `headers`):

```ts
const controller = new AbortController();
await client.upload("large.bin", buffer, {
  signal: controller.signal,
  timeoutMs: 15_000,
});
```

## License

MIT
