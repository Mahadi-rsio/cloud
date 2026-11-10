import { createClient, type Client } from "@libsql/client";
import { getEnv } from "@/lib/env";

export const DEFAULT_DATA_URL = "https://libsql-database-service.fly.dev";

function namespaceFetch(namespace: string): typeof fetch {
  return (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set("x-namespace", namespace);
    return fetch(new Request(request, { headers }));
  };
}

/**
 * Server-side libSQL client for a tenant namespace.
 *
 * Connects through the public sqld data-plane URL and routes with the
 * `x-namespace` header, which works from Workers (unlike a tenant subdomain
 * proxied through the same Cloudflare zone).
 */
export async function createTenantClient(
  namespace: string,
  authToken: string,
): Promise<Client> {
  const env = await getEnv();
  return createClient({
    url: env.LIBSQL_DATA_URL || DEFAULT_DATA_URL,
    authToken,
    fetch: namespaceFetch(namespace),
  });
}
