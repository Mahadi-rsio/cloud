import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Billing",
};

export default function BillingPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your plan, invoices, and payment methods will appear here.
        </p>
      </CardContent>
    </Card>
  );
}