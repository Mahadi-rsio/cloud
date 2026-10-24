import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { kvSecondaryStorage } from "@/lib/auth/storage/kv";
import { enqueueAuthJob } from "@/lib/queue";

let cached: ReturnType<typeof createAuth> | undefined;

function createAuth(db: Awaited<ReturnType<typeof getDb>>, secret: string, baseURL: string) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    secret,
    baseURL,
    trustedOrigins: [baseURL].filter(Boolean),
    secondaryStorage: kvSecondaryStorage(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 72,
    },
    socialProviders: {},
    advanced: {
      cookiePrefix: "better-auth",
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await enqueueAuthJob({
              type: "welcome-email",
              userId: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
      },
    },
  });
}

export async function getAuth() {
  if (cached) return cached;
  const env = await getEnv();
  const db = await getDb();
  if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL) {
    throw new Error("BETTER_AUTH_SECRET and BETTER_AUTH_URL are required");
  }
  cached = createAuth(db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL);
  return cached;
}