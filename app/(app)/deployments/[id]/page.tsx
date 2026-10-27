import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DeploymentDetailPage } from "@/components/deployments/deployment-detail";

export const metadata = {
  title: "Deployment",
};

export default async function DeploymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <DeploymentDetailPage deploymentId={id} />;
}