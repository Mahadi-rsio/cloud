import { getSession } from "@/lib/auth/session";
import { HttpError } from "@/lib/http";

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) {
    throw new HttpError("UNAUTHENTICATED", "Authentication required.", 401);
  }
  return session.user;
}

export function assertOwnership(resourceUserId: string, userId: string) {
  if (resourceUserId !== userId) {
    throw new HttpError("FORBIDDEN", "You do not have access to this resource.", 403);
  }
}
