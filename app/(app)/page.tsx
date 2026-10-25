import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Dashboard",
};

export default function HomePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Your session is active. Use the sidebar to navigate your apps,
          billing, settings, and more.
        </p>
      </CardContent>
    </Card>
  );
}