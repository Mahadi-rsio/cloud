import Box from "@mui/material/Box";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { SettingsFormProvider } from "@/components/settings/settings-form";

export const metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <Box sx={{ mx: "auto", width: "100%", maxWidth: "42rem" }}>
      <SettingsFormProvider
        user={{ name: session.user.name, email: session.user.email }}
      />
    </Box>
  );
}
