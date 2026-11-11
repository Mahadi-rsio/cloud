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
import Typography from "@mui/material/Typography";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { signInSchema, signUpSchema } from "@/lib/validators/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
        className="border-border/80 p-6 sm:p-7 shadow-xl rounded-2xl bg-card"
      >
        <CardHeader className="p-0 pb-5 border-none">
          <CardTitle className="text-xl sm:text-2xl font-bold">
            {store.mode === "signin" ? "Welcome back" : "Create an account"}
          </CardTitle>
          <CardDescription className="text-sm">
            {store.mode === "signin"
              ? "Sign in to deploy apps, manage databases, and object storage."
              : "Get started with your free developer cloud account."}
          </CardDescription>
        </CardHeader>

        <CardContent className="p-0">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {store.mode === "signup" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Ada Lovelace"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Work Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  store.mode === "signin" ? "current-password" : "new-password"
                }
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>

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
              disabled={busy}
              className="w-full mt-2 h-10.5 text-sm font-semibold"
            >
              {busy
                ? "Please wait…"
                : store.mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>
        </CardContent>

        <Box
          sx={{
            mt: 4,
            pt: 3,
            borderTop: "1px solid var(--border)",
            textAlign: "center",
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: "var(--muted-foreground)" }}
          >
            {store.mode === "signin"
              ? "Don't have an account yet?"
              : "Already have an account?"}{" "}
            <Button
              variant="link"
              onClick={() =>
                store.setMode(store.mode === "signin" ? "signup" : "signin")
              }
              className="font-semibold text-primary"
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
