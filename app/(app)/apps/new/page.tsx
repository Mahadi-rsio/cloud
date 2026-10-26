import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { CreateApplicationPageProvider } from "@/components/apps/create-application-page";

export const metadata = {
  title: "Create App",
};

export default async function NewApplicationPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <CreateApplicationPageProvider />;
}
