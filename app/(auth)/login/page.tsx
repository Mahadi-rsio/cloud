import Box from "@mui/material/Box";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { LoginFormProvider } from "@/components/auth/login-form";

export const metadata = {
  title: "Sign in",
};

export const instant = false;

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <Box
      component="main"
      sx={{
        display: "flex",
        minHeight: "100svh",
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        px: 3,
      }}
    >
      <Box sx={{ mx: "auto", width: "100%", maxWidth: 400 }}>
        <LoginFormProvider />
      </Box>
    </Box>
  );
}
