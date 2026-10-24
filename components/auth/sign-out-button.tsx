"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={async () => {
        await api.post("/sign-out");
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}