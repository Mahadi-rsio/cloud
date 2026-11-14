# Cloud Storage TypeScript SDK (`@cloudisy/storage`)

The official zero-dependency TypeScript SDK for the `/api/v1/storage` Object Storage API is published as [`@cloudisy/storage`](../packages/storage-sdk/README.md) and located in `packages/storage-sdk/`.

## Installation

```bash
npm install @cloudisy/storage
# or
pnpm add @cloudisy/storage
```

## Quickstart

```ts
import { createStorageClient } from "@cloudisy/storage";

const storage = createStorageClient({
  baseUrl: "https://cloud.rsioex.workers.dev",
  apiKey: process.env.CLOUD_STORAGE_API_KEY,
  namespace: "my-bucket",
});

// Upload
await storage.upload("hello.txt", "Hello, Cloud!", {
  contentType: "text/plain",
  metadata: { source: "quickstart" },
});

// Download
const file = await storage.download("hello.txt");
console.log(await file.text());

// List all objects
for await (const obj of storage.listAll()) {
  console.log(obj.path, obj.size, obj.etag);
}
```

## Core Concepts

- **Client & Authentication**: Pass `apiKey` (defaults to `x-api-key` header, or set `authHeader: "bearer"` for `Authorization: Bearer <key>`). In same-origin browser apps, omit `baseUrl` and `apiKey` to use session cookies.
- **Default vs. Scoped Namespaces**: Pass `namespace` in `createStorageClient` to call `storage.upload(...)`, `storage.download(...)`, `storage.list(...)`, etc. directly, or call `storage.namespace("other-bucket")` to work across multiple namespaces.
- **Presigned URLs**: Generate short-lived `PUT` (`action: "write"`) or `GET` (`action: "read"`) URLs with `storage.createPresignedUrl(path, options)`, then upload/download directly via `storage.presigned.upload(url, body)` and `storage.presigned.download(url)`.
- **Management & Metering**: Inspect quotas and consumption with `storage.getUsage()` / `storage.getTenant()`, manage buckets via `storage.namespaces`, and issue/revoke keys via `storage.apiKeys`.
- **Errors & Rate Limits**: Failed requests throw `StorageApiError` containing `status`, `code`, `message`, `details`, and `rateLimit`.

For the complete API reference and option tables, see [`packages/storage-sdk/README.md`](../packages/storage-sdk/README.md).
