import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { BucketDetailPage } from "@/components/storage/bucket-detail-page";

export const metadata = {
  title: "Bucket Details",
};

export default async function StorageBucketDetailRoutePage({
  params,
}: {
  params: Promise<{ bucket: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const { bucket } = await params;
  return <BucketDetailPage bucketName={decodeURIComponent(bucket)} />;
}
