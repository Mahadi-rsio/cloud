import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { ApplicationDetailProvider } from "@/components/apps/application-detail";

export const metadata = {
  title: "Application",
};

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <ApplicationDetailProvider id={id} />;
}