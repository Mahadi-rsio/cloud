import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/libsql";
import { createTenantClient } from "@/lib/databases/tenant-client";
import { getEnv } from "@/lib/env";
import { authSchema } from "./auth-schema";
import { authProjectService } from "./service";

type AuthInstance = {
  handler: (request: Request) => Promise<Response>;
};

const instanceCache = new Map<string, AuthInstance>();

export async function getAuthForProject(
  publishableKey: string,
  baseURL?: string,
): Promise<AuthInstance> {
  const cacheKey = `${publishableKey}:${baseURL ?? "default"}`;
  const cached = instanceCache.get(cacheKey);
  if (cached) return cached;

  const project = await authProjectService.getByPublishableKey(publishableKey);
  const env = await getEnv();
  const configuredOrigins = (env.AUTH_RUNTIME_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const client = await createTenantClient(project.namespace, project.defaultToken);
  const db = drizzle(client, { schema: authSchema });

  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: project.authSecret,
    baseURL,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 72,
    },
    trustedOrigins: (request) => {
      const origin = request?.headers.get("origin");
      if (configuredOrigins.length > 0) {
        return Array.from(
          new Set([...configuredOrigins, ...(origin ? [origin] : [])]),
        );
      }
      return origin ? [origin] : [];
    },
    advanced: {
      cookiePrefix: "cloud-auth",
      defaultCookieAttributes: {
        sameSite: baseURL?.startsWith("https://") ? "none" : "lax",
        secure: baseURL?.startsWith("https://") ?? false,
      },
    },
  });

  instanceCache.set(cacheKey, auth);
  return auth;
}
