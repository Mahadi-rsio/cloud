import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export function PlaceholderPage({
  title,
  description,
  icon,
  comingSoon,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  comingSoon: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title={comingSoon}
        description="This section is coming soon. Your existing apps and data are unaffected."
      />
    </div>
  );
}