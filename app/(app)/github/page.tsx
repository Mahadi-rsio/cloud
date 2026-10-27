import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { GitHubDeployPage } from "@/components/github/github-page";

export const metadata = {
  title: "GitHub",
};

export default async function GitHubPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <GitHubDeployPage />;
}