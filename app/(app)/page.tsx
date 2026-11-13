import Link from "next/link";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { AppWindow } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata = {
  title: "Dashboard",
};

export default function HomePage() {
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
      <PageHeader
        title="Dashboard"
        description="Deploy backend apps from a Docker image and get a public URL."
      />
      <EmptyState
        icon={<AppWindow size={20} />}
        title="Welcome to Cloudisy"
        description="Create your first app to get a public URL, or explore the sidebar to manage databases, domains and billing."
        action={
          <Button component={Link} href="/apps" variant="contained">
            Go to Apps
          </Button>
        }
      />
    </Box>
  );
}
