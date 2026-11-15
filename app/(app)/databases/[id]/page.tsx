import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DatabaseDetailPage } from "@/components/databases/database-detail-page";

export const metadata = {
  title: "Database Details",
};

export default async function DatabaseDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  return <DatabaseDetailPage databaseId={id} />;
}
