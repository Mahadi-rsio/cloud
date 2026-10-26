import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AppsPageProvider } from "@/components/apps/apps-page";

export const metadata = {
  title: "Apps",
};

export default async function AppsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <AppsPageProvider />;
}