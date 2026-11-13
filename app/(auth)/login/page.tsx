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
        position: "relative",
        display: "flex",
        minHeight: "100svh",
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        px: { xs: 2, sm: 3 },
        py: 4,
        background:
          "radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 70%), var(--background)",
      }}
    >
      <Box sx={{ mx: "auto", width: "100%", maxWidth: 440 }}>
        <LoginFormProvider />
      </Box>
    </Box>
  );
}
