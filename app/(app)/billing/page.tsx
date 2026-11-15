import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { PageHeader } from "@/components/shared/page-header";

export const metadata = {
  title: "Billing",
};

export default function BillingPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <PageHeader
        title="Billing"
        description="Manage your plan, invoices, and payment methods."
      />
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Your plan, invoices, and payment methods will appear here.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
