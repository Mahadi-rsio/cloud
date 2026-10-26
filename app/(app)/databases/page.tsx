import { Database } from "lucide-react";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata = {
  title: "Databases",
};

export default function DatabasesPage() {
  return (
    <PlaceholderPage
      title="Databases"
      description="Provision and manage managed databases for your apps."
      icon={<Database className="size-5" />}
      comingSoon="Databases are coming soon"
    />
  );
}