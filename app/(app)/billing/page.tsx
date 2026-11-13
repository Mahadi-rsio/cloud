import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";

export const metadata = {
  title: "Billing",
};

export default function BillingPage() {
  return (
    <Card>
      <CardHeader title="Billing" />
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          Your plan, invoices, and payment methods will appear here.
        </Typography>
      </CardContent>
    </Card>
  );
}
