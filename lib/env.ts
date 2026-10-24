type Env = {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
};

let cached: Env | undefined;

export async function getEnv(): Promise<Env> {
  if (cached) return cached;
  try {
    const { env } = await import("cloudflare:workers");
    if (env?.DATABASE_URL) {
      cached = {
        DATABASE_URL: env.DATABASE_URL,
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: env.BETTER_AUTH_URL,
      };
      return cached;
    }
  } catch {
    // not running on Cloudflare
  }
  cached = {
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  };
  return cached;
}