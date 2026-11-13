import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Typography from "@mui/material/Typography";

export const metadata = {
  title: "Documentation",
};

export default function DocsPage() {
  return (
    <Card>
      <CardHeader title="Documentation" />
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          Guides and API references will appear here.
        </Typography>
      </CardContent>
    </Card>
  );
}
