import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = {
  title: "Privacy policy",
};

export default function PrivacyPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <PageHeader
        title="Privacy policy"
        description="How Cloudisy handles your account, workspace, and deployment data."
      />
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Our privacy policy will live here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
