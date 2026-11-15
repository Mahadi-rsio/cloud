import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { StudioLoader } from "@/components/studio/StudioLoader";

export const metadata = {
  title: "SQLite Studio",
};

export default async function DatabaseStudioRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { id } = await params;
  return <StudioLoader databaseId={id} />;
}
