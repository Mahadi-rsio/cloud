import { Globe } from "lucide-react";
import { PlaceholderPage } from "@/components/shared/placeholder-page";

export const metadata = {
  title: "Domains",
};

export default function DomainsPage() {
  return (
    <PlaceholderPage
      title="Domains"
      description="Connect custom domains to your apps."
      icon={<Globe size={20} />}
      comingSoon="Domains are coming soon"
    />
  );
}
