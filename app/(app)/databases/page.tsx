import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DatabasesPage } from "@/components/databases/databases-page";

export const metadata = {
  title: "Databases",
};

export default async function DatabasesRoutePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <DatabasesPage />;
}
