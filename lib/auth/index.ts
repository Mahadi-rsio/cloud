import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { member as memberTable, organization as organizationTable } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

function toOrgSlug(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `${base || "workspace"}-${suffix}`;
}

function createAuth(db: Awaited<ReturnType<typeof getDb>>, secret: string, fallbackURL: string) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    secret,
    baseURL: {
      allowedHosts: ["localhost:*", "*.workers.dev"],
      protocol: "auto",
      fallback: fallbackURL,
    },
    // Authoritative sessions remain in Neon PostgreSQL; short-lived signed
    // cookieCache eliminates repeated DB session lookups on hot read paths
    // without relying on Redis or eventually consistent KV for session state.
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60,
        strategy: "compact",
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 72,
    },
    socialProviders: {},
    plugins: [
      organization({
        allowUserToCreateOrganization: true,
      }),
      apiKey({
        // Allow getSession() to work with x-api-key header
        enableSessionForAPIKeys: true,
        // Rate limiting disabled by default; adjust per use-case
        rateLimit: {
          enabled: false,
        },
        // Store arbitrary JSON metadata with each key
        enableMetadata: true,
        // Also look for key in Authorization header (Bearer <key>)
        customAPIKeyGetter: (ctx) => {
          return (
            ctx.request?.headers.get("x-api-key") ??
            ctx.request?.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
            null
          );
        },
      }),
    ],
    advanced: {
      cookiePrefix: "better-auth",
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const orgId = crypto.randomUUID();
            const memberId = crypto.randomUUID();
            const orgName = "Personal";
            const slug = toOrgSlug("personal");

            try {
              await db.insert(organizationTable).values({
                id: orgId,
                name: orgName,
                slug,
                createdAt: new Date(),
              });
              await db.insert(memberTable).values({
                id: memberId,
                organizationId: orgId,
                userId: user.id,
                role: "owner",
                createdAt: new Date(),
              });
            } catch (error) {
              console.error("Failed to create default organization for user:", user.id, error);
            }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            if (session.activeOrganizationId) {
              return { data: session };
            }
            try {
              const memberships = await db
                .select({ organizationId: memberTable.organizationId })
                .from(memberTable)
                .where(eq(memberTable.userId, session.userId))
                .limit(1);

              const firstOrgId = memberships[0]?.organizationId;
              if (firstOrgId) {
                return {
                  data: {
                    ...session,
                    activeOrganizationId: firstOrgId,
                  },
                };
              }
            } catch (error) {
              console.error("Failed to attach default activeOrganizationId:", error);
            }
            return { data: session };
          },
        },
      },
    },
  });
}

export async function getAuth() {
  const env = await getEnv();
  const db = await getDb();
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  return createAuth(db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL || "http://localhost:3001");
}