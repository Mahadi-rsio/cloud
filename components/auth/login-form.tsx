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
    <Card>
      <CardHeader>
        <CardTitle>
          {store.mode === "signin" ? "Welcome back" : "Create your account"}
        </CardTitle>
        <CardDescription>
          {store.mode === "signin"
            ? "Sign in to your account to continue."
            : "Sign up with your email and a password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {store.mode === "signup" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
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
            />
          </div>
          {store.error && (
            <p
              role="alert"
              className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
            >
              {store.error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : store.mode === "signin"
                ? "Sign in"
                : "Sign up"}
          </Button>
        </form>
      </CardContent>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {store.mode === "signin"
            ? "Don't have an account?"
            : "Already have an account?"}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline"
            onClick={() =>
              store.setMode(store.mode === "signin" ? "signup" : "signin")
            }
          >
            {store.mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}

export function LoginFormProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginForm />
    </QueryClientProvider>
  );
}