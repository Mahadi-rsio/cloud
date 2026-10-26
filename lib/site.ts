/**
 * Single source of truth for product identity and the public app domain.
 * The public domain is read from one config value (`APP_DOMAIN`) so it can be
 * switched to a Cloudisy-owned domain later without touching component code.
 */

export const SITE_NAME = "Cloudisy";

export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "fly.dev";

export function appUrl(slug: string): string {
  return `https://${slug}.${APP_DOMAIN}`;
}