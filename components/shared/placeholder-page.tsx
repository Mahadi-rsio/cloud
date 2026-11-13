import Box from "@mui/material/Box";
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
    <Box
      sx={{
        mx: "auto",
        display: "flex",
        width: "100%",
        maxWidth: "64rem",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={icon}
        title={comingSoon}
        description="This section is coming soon. Your existing apps and data are unaffected."
      />
    </Box>
  );
}
