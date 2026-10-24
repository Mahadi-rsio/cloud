import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";

export async function getSession() {
  const auth = await getAuth();
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  return session;
}