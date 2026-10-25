"use client";

import * as React from "react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import { Dialog } from "radix-ui";
import { z } from "zod";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
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

const updateNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or fewer."),
});

function SettingsForm({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateName = useMutation({
    mutationFn: async () => {
      const input = updateNameSchema.parse({ name });
      return api.post("/update-user", input);
    },
    onSuccess: () => {
      setProfileError(null);
      router.refresh();
    },
    onError: (error) => setProfileError(extractErrorMessage(error)),
  });

  const signOut = useMutation({
    mutationFn: async () => api.post("/sign-out", {}),
    onSuccess: () => {
      router.push("/login");
      router.refresh();
    },
    onError: (error) => setSessionError(extractErrorMessage(error)),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProfileError(null);
    updateName.mutate();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Update your display name. This is shown across the app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={user.email}
                disabled
              />
            </div>
            {profileError && (
              <p
                role="alert"
                className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
              >
                {profileError}
              </p>
            )}
            <Button type="submit" disabled={updateName.isPending}>
              {updateName.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            End this session or permanently remove your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Log out</p>
                <p className="text-xs text-muted-foreground">
                  Sign out of your account on this device.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => signOut.mutate()}
              >
                <LogOut />
                Log out
              </Button>
            </div>
            {sessionError && (
              <p
                role="alert"
                className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
              >
                {sessionError}
              </p>
            )}
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive-foreground">
                  Delete account
                </p>
                <p className="text-xs text-muted-foreground">
                  Permanently delete your account and all of your data.
                </p>
              </div>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                Delete account
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DeleteAccountDialog
        email={user.email}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => {
          router.push("/login");
          router.refresh();
        }}
      />
    </div>
  );
}

function DeleteAccountDialog({
  email,
  open,
  onOpenChange,
  onDeleted,
}: {
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const deleteAccount = useMutation({
    mutationFn: async () => api.post("/delete-user", { password }),
    onSuccess: () => {
      setPassword("");
      setError(null);
      onOpenChange(false);
      onDeleted();
    },
    onError: (deleteError) => setError(extractErrorMessage(deleteError)),
  });

  const reset = () => {
    setPassword("");
    setError(null);
    deleteAccount.reset();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-base font-semibold text-foreground">
            Delete account
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            This will permanently delete{" "}
            <span className="font-medium text-foreground">{email}</span> and all
            associated data. This action cannot be undone. Enter your password
            to confirm.
          </Dialog.Description>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="delete-password">Password</Label>
            <Input
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && password && !deleteAccount.isPending) {
                  setError(null);
                  deleteAccount.mutate();
                }
              }}
            />
          </div>
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
            >
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleteAccount.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!password || deleteAccount.isPending}
              onClick={() => {
                setError(null);
                deleteAccount.mutate();
              }}
            >
              {deleteAccount.isPending ? "Deleting…" : "Delete account"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const queryClient = new QueryClient();

export function SettingsFormProvider({
  user,
}: {
  user: { name: string; email: string };
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsForm user={user} />
    </QueryClientProvider>
  );
}