import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";

export const metadata = {
  title: "Privacy policy",
};

export default function PrivacyPage() {
  return (
    <Card>
      <CardHeader title="Privacy policy" />
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          Our privacy policy will live here.
        </Typography>
      </CardContent>
    </Card>
  );
}
