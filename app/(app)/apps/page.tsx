import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Apps",
};

export default function AppsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Apps</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your connected apps will appear here.
        </p>
      </CardContent>
    </Card>
  );
}