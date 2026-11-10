import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AuthProjectsPage } from "@/components/auth-projects/auth-projects-page";

export const metadata = {
  title: "Auth",
};

export default async function AuthRoutePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <AuthProjectsPage />;
}
