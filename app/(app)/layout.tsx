import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
    >
      {children}
    </AppShell>
  );
}