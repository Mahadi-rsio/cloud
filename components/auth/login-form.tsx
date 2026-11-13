"use client";

import * as React from "react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ZodError } from "zod";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Building2, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useAuthStore, type AuthMode } from "@/stores/auth-store";
import { authClient } from "@/lib/auth-client";
import { signInSchema, signUpSchema } from "@/lib/validators/auth";
import { Wordmark } from "@/components/shell/wordmark";

function extractErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Please check your input.";
  }
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "Something went wrong. Please try again.";
}

const queryClient = new QueryClient();

function LoginForm() {
  const router = useRouter();
  const store = useAuthStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const ensureActiveOrganization = async () => {
    try {
      const { data: orgs } = await authClient.organization.list();
      if (Array.isArray(orgs) && orgs.length > 0) {
        const { data: session } = await authClient.getSession();
        const activeOrgId = (session?.session as { activeOrganizationId?: string | null } | undefined)
          ?.activeOrganizationId;
        if (!activeOrgId) {
          await authClient.organization.setActive({
            organizationId: orgs[0].id,
          });
        }
      }
    } catch {
      // Non-fatal; user can still select or create an org in the dashboard.
    }
  };

  const signIn = useMutation({
    mutationFn: async () => {
      const input = signInSchema.parse({ email, password });
      const res = await authClient.signIn.email({
        email: input.email,
        password: input.password,
      });
      if (res.error) {
        throw new Error(res.error.message || "Invalid email or password.");
      }
      await ensureActiveOrganization();
      return res.data;
    },
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
    onError: (error) => store.setError(extractErrorMessage(error)),
  });

  const signUp = useMutation({
    mutationFn: async () => {
      const input = signUpSchema.parse({ name, email, password });
      const res = await authClient.signUp.email({
        name: input.name,
        email: input.email,
        password: input.password,
      });
      if (res.error) {
        throw new Error(res.error.message || "Could not create account.");
      }
      await ensureActiveOrganization();
      return res.data;
    },
    onSuccess: () => {
      router.push("/");
      router.refresh();
    },
    onError: (error) => store.setError(extractErrorMessage(error)),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    store.setError(null);
    if (store.mode === "signin") {
      signIn.mutate();
    } else {
      signUp.mutate();
    }
  };

  const busy = signIn.isPending || signUp.isPending;

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 3, gap: 1 }}>
        <Wordmark />
        <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
          Deploy apps, libSQL databases, and object storage
        </Typography>
      </Box>

      <Card
        elevation={2}
        sx={{
          borderRadius: "16px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--card)",
          overflow: "hidden",
        }}
      >
        <Tabs
          value={store.mode}
          onChange={(_, nextMode: AuthMode) => store.setMode(nextMode)}
          variant="fullWidth"
          sx={{
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--muted)",
            minHeight: 44,
            "& .MuiTab-root": {
              minHeight: 44,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
              color: "var(--muted-foreground)",
            },
            "& .Mui-selected": {
              color: "var(--foreground)",
              backgroundColor: "var(--card)",
            },
          }}
        >
          <Tab value="signin" label="Sign in" />
          <Tab value="signup" label="Create account" />
        </Tabs>

        <CardContent sx={{ p: { xs: 3, sm: 3.5 } }}>
          <Box sx={{ pb: 2.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
              {store.mode === "signin" ? "Welcome back" : "Create your workspace"}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--muted-foreground)" }}>
              {store.mode === "signin"
                ? "Sign in to access your organization and cloud resources."
                : "Get started with a free developer account and personal organization."}
            </Typography>
          </Box>

          <Box
            component="form"
            onSubmit={submit}
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            {store.mode === "signup" && (
              <TextField
                id="name"
                name="name"
                label="Full Name"
                type="text"
                size="small"
                fullWidth
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <User size={16} style={{ color: "var(--muted-foreground)" }} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
            )}

            <TextField
              id="email"
              name="email"
              label="Work Email"
              type="email"
              size="small"
              fullWidth
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Mail size={16} style={{ color: "var(--muted-foreground)" }} />
                    </InputAdornment>
                  ),
                },
              }}
            />

            <TextField
              id="password"
              name="password"
              label="Password"
              type={showPassword ? "text" : "password"}
              size="small"
              fullWidth
              autoComplete={
                store.mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="••••••••"
              helperText={
                store.mode === "signup" ? "Must be at least 8 characters." : undefined
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Lock size={16} style={{ color: "var(--muted-foreground)" }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((prev) => !prev)}
                        edge="end"
                        sx={{ color: "var(--muted-foreground)" }}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />

            {store.mode === "signup" && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  px: 1.5,
                  py: 1,
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--muted)",
                }}
              >
                <Building2 size={16} style={{ color: "var(--primary)", flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  A default organization will be created automatically when you sign up.
                </Typography>
              </Box>
            )}

            {store.error && (
              <Alert
                severity="error"
                sx={{
                  borderRadius: "10px",
                  fontSize: "0.8125rem",
                  py: 0.5,
                }}
              >
                {store.error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={busy}
              sx={{ mt: 0.5, height: 42, fontWeight: 600 }}
            >
              {busy
                ? "Please wait…"
                : store.mode === "signin"
                  ? "Sign in"
                  : "Create account & workspace"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}

export function LoginFormProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginForm />
    </QueryClientProvider>
  );
}
