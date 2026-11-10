import { createTenantClient } from "@/lib/databases/tenant-client";
import { HttpError } from "@/lib/http";

export interface StudioConnection {
  namespace: string;
  token: string;
}

/**
 * Builds a libSQL client for the tenant database the user selected in the
 * studio.
 *
 * Connections route through the shared sqld data-plane URL using the
 * `x-namespace` header (see `createTenantClient`). A direct connection to a
 * per-tenant subdomain (e.g. `libsql://{namespace}.cloudisy.top`) does not work
 * from Workers because those hosts are proxied through the same Cloudflare zone
 * and outbound fetches to them fail with an origin (530) error.
 *
 * The token comes from the database record on the server; it is never sent from
 * or persisted on the client.
 */
export async function createStudioClient(connection: StudioConnection) {
  const namespace = connection.namespace.trim();
  const token = connection.token.trim();
  if (!namespace) {
    throw new HttpError("VALIDATION_ERROR", "No database selected.", 400);
  }
  if (!token) {
    throw new HttpError("VALIDATION_ERROR", "No auth token is available for this database.", 400);
  }
  return createTenantClient(namespace, token);
}