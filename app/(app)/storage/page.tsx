import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { StoragePageProvider } from "@/components/storage/storage-page";

export const metadata = {
  title: "Storage",
};

export default async function StorageRoutePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <StoragePageProvider />;
}
