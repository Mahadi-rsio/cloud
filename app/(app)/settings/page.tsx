import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SettingsFormProvider } from "@/components/settings/settings-form";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <SettingsFormProvider
        user={{ name: session.user.name, email: session.user.email }}
      />
    </div>
  );
}