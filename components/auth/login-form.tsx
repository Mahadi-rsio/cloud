"use client";

import * as React from "react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useRouter } from "next/navigation";
import { ZodError } from "zod";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { signInSchema, signUpSchema } from "@/lib/validators/auth";
import { Wordmark } from "@/components/shell/wordmark";

function extractErrorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Please check your input.";
  }
  if (isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && typeof message[0]?.message === "string") {
      return message[0].message;
    }
    return "Something went wrong. Please try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

const queryClient = new QueryClient();

function LoginForm() {
  const router = useRouter();
  const store = useAuthStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const signIn = useMutation({
    mutationFn: async () => {
      const input = signInSchema.parse({ email, password });
      return api.post("/sign-in/email", input);
    },
    onSuccess: () => router.push("/"),
    onError: (error) => store.setError(extractErrorMessage(error)),
  });

  const signUp = useMutation({
    mutationFn: async () => {
      const input = signUpSchema.parse({ name, email, password });
      return api.post("/sign-up/email", input);
    },
    onSuccess: () => router.push("/"),
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
    <Box sx={{ width: "100%", maxWidth: 420, mx: "auto" }}>
      <Box sx={{ display: "flex", justifyContent: "center", mb: 3 }}>
        <Wordmark />
      </Box>

      <Card
        elevation={2}
        sx={{
          p: { xs: 3, sm: 3.5 },
          borderRadius: "16px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--card)",
        }}
      >
        <Box sx={{ pb: 2.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
            {store.mode === "signin" ? "Welcome back" : "Create an account"}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {store.mode === "signin"
              ? "Sign in to deploy apps, manage databases, and object storage."
              : "Get started with your free developer cloud account."}
          </Typography>
        </Box>

        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
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
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <TextField
              id="password"
              name="password"
              label="Password"
              type="password"
              size="small"
              fullWidth
              autoComplete={
                store.mode === "signin" ? "current-password" : "new-password"
              }
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

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
              sx={{ mt: 1, height: 42, fontWeight: 600 }}
            >
              {busy
                ? "Please wait…"
                : store.mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </Box>
        </CardContent>

        <Divider sx={{ my: 3 }} />

        <Box sx={{ textAlign: "center" }}>
          <Typography variant="body2" sx={{ color: "var(--muted-foreground)" }}>
            {store.mode === "signin"
              ? "Don't have an account yet?"
              : "Already have an account?"}{" "}
            <Button
              type="button"
              variant="text"
              size="small"
              onClick={() =>
                store.setMode(store.mode === "signin" ? "signup" : "signin")
              }
              sx={{ fontWeight: 600, minWidth: 0, p: 0.5 }}
            >
              {store.mode === "signin" ? "Sign up" : "Sign in"}
            </Button>
          </Typography>
        </Box>
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
