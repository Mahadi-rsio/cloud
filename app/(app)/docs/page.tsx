import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Documentation",
};

export default function DocsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentation</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Guides and API references will appear here.
        </p>
      </CardContent>
    </Card>
  );
}