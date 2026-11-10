import { requireUser } from "@/lib/authz";

/**
 * Guards access to the database studio.
 *
 * Requires an authenticated session. Users connect with their own database
 * URL + auth token inside the studio, so no shared allowlist is needed here.
 */
export async function requireStudioAdmin() {
  return requireUser();
}