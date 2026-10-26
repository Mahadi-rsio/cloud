type Env = {
  DATABASE_URL?: string;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  FLY_API_TOKEN?: string;
  FLY_ORG_SLUG?: string;
  FLY_DEFAULT_REGION?: string;
  FLY_DEFAULT_IMAGE?: string;
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
        FLY_API_TOKEN: env.FLY_API_TOKEN,
        FLY_ORG_SLUG: env.FLY_ORG_SLUG,
        FLY_DEFAULT_REGION: env.FLY_DEFAULT_REGION,
        FLY_DEFAULT_IMAGE: env.FLY_DEFAULT_IMAGE,
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
    FLY_API_TOKEN: process.env.FLY_API_TOKEN,
    FLY_ORG_SLUG: process.env.FLY_ORG_SLUG,
    FLY_DEFAULT_REGION: process.env.FLY_DEFAULT_REGION,
    FLY_DEFAULT_IMAGE: process.env.FLY_DEFAULT_IMAGE,
  };
  return cached;
}