import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Cloud",
};

export default async function HomePage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-svh flex-1 items-center justify-center px-6">
      <div className="mx-auto w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>Signed in</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Welcome,{" "}
              <span className="font-medium text-foreground">
                {session.user.name}
              </span>{" "}
              ({session.user.email}). Your session is active.
            </p>
          </CardContent>
          <CardContent>
            <SignOutButton />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}