import Link from "next/link";
import { AppWindow } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Dashboard",
};

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Deploy backend apps from a Docker image and get a public URL."
      />
      <EmptyState
        icon={<AppWindow className="size-5" />}
        title="Welcome to Cloudisy"
        description="Create your first app to get a public URL, or explore the sidebar to manage databases, domains and billing."
        action={
          <Button asChild>
            <Link href="/apps">Go to Apps</Link>
          </Button>
        }
      />
    </div>
  );
}