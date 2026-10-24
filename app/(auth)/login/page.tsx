import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginFormProvider } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in",
};

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-svh flex-1 items-center justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <LoginFormProvider />
      </div>
    </main>
  );
}