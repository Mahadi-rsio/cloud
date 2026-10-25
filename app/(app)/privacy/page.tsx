import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Privacy policy",
};

export default function PrivacyPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy policy</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Our privacy policy will live here.
        </p>
      </CardContent>
    </Card>
  );
}