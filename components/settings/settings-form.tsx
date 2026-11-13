"use client";

import * as React from "react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { LogOut, Trash2 } from "lucide-react";
import { z } from "zod";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";

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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Card>
        <CardHeader
          title="Profile"
          subheader="Update your display name. This is shown across the app."
        />
        <CardContent>
          <Box
            component="form"
            onSubmit={submit}
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <TextField
              id="name"
              name="name"
              label="Name"
              type="text"
              size="small"
              fullWidth
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              id="email"
              name="email"
              label="Email"
              type="email"
              size="small"
              fullWidth
              autoComplete="email"
              value={user.email}
              disabled
            />
            {profileError && (
              <Alert severity="error">{profileError}</Alert>
            )}
            <Box>
              <Button type="submit" variant="contained" disabled={updateName.isPending}>
                {updateName.isPending ? "Saving…" : "Save changes"}
              </Button>
            </Box>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Session"
          subheader="End this session or permanently remove your account."
        />
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Log out
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Sign out of your account on this device.
              </Typography>
            </Box>
            <Button
              type="button"
              variant="outlined"
              startIcon={<LogOut size={16} />}
              onClick={() => signOut.mutate()}
            >
              Log out
            </Button>
          </Box>

          {sessionError && <Alert severity="error">{sessionError}</Alert>}

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
                Delete account
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Permanently delete your account and all of your data.
              </Typography>
            </Box>
            <Button
              type="button"
              variant="contained"
              color="error"
              startIcon={<Trash2 size={16} />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete account
            </Button>
          </Box>
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
    </Box>
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

  const handleClose = () => {
    setPassword("");
    setError(null);
    deleteAccount.reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete account</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <DialogContentText>
          This will permanently delete{" "}
          <Box component="span" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
            {email}
          </Box>{" "}
          and all associated data. This action cannot be undone. Enter your
          password to confirm.
        </DialogContentText>
        <TextField
          id="delete-password"
          name="password"
          label="Password"
          type="password"
          size="small"
          fullWidth
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
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          type="button"
          variant="outlined"
          disabled={deleteAccount.isPending}
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="contained"
          color="error"
          disabled={!password || deleteAccount.isPending}
          onClick={() => {
            setError(null);
            deleteAccount.mutate();
          }}
        >
          {deleteAccount.isPending ? "Deleting…" : "Delete account"}
        </Button>
      </DialogActions>
    </Dialog>
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
