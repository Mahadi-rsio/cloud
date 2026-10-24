import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as authSchema from "./schema";
import { getEnv } from "@/lib/env";

neonConfig.fetchConnectionCache = true;

let cached: ReturnType<typeof createDb> | undefined;

function createDb(url: string) {
  return drizzle(neon(url), { schema: authSchema });
}

export async function getDb() {
  if (cached) return cached;
  const env = await getEnv();
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }
  cached = createDb(env.DATABASE_URL);
  return cached;
}

export { authSchema };