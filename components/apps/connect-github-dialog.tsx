"use client";

import * as React from "react";
import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AlertCircle, CheckCircle2, KeyRound, Sparkles, User, X } from "lucide-react";
import { connectGitHub, type GitHubRepoItem } from "@/lib/github-client";
import { extractErrorMessage } from "@/lib/errors";

function GitHubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

interface ConnectGitHubDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: { username: string; repos: GitHubRepoItem[] }) => void;
}

export function ConnectGitHubDialog({ open, onClose, onSuccess }: ConnectGitHubDialogProps) {
  const [tab, setTab] = useState<"quick" | "token">("quick");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (tab === "quick") {
        const targetUser = username.trim() || "facebook";
        const res = await connectGitHub({ username: targetUser });
        onSuccess({ username: res.username || targetUser, repos: res.repos });
        onClose();
      } else {
        const trimmedToken = token.trim();
        if (!trimmedToken) {
          throw new Error("Please enter your GitHub Personal Access Token.");
        }
        const res = await connectGitHub({ token: trimmedToken });
        onSuccess({ username: res.username || "github-user", repos: res.repos });
        onClose();
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickDemo = async (demoUsername: string) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await connectGitHub({ username: demoUsername });
      onSuccess({ username: res.username || demoUsername, repos: res.repos });
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: "var(--card)",
            backgroundImage: "none",
            border: "1px solid var(--border)",
            borderRadius: 3,
          },
        },
      }}
    >
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pb: 1.5,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                bgcolor: "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <GitHubIcon size={18} />
            </Box>
            <Typography sx={{ fontSize: 16, fontWeight: 600 }}>Connect GitHub Account</Typography>
          </Stack>
          <IconButton size="small" onClick={onClose} aria-label="Close dialog">
            <X size={16} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ pt: 2.5, pb: 3 }}>
          <Stack spacing={2.5}>
            <Tabs
              value={tab}
              onChange={(_, val) => {
                setTab(val);
                setError(null);
              }}
              sx={{
                minHeight: 36,
                borderBottom: "1px solid var(--border)",
                "& .MuiTab-root": { minHeight: 36, textTransform: "none", fontSize: 13, py: 0.5 },
              }}
            >
              <Tab value="quick" label="Public Profile / Demo" icon={<User size={14} />} iconPosition="start" />
              <Tab value="token" label="Personal Access Token" icon={<KeyRound size={14} />} iconPosition="start" />
            </Tabs>

            {tab === "quick" ? (
              <Stack spacing={2}>
                <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                  Connect your GitHub public profile to automatically load and import your public repositories.
                </Typography>

                <Box>
                  <Typography component="label" htmlFor="gh-username" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                    GitHub Username or Organization
                  </Typography>
                  <TextField
                    id="gh-username"
                    size="small"
                    fullWidth
                    autoComplete="off"
                    placeholder="e.g. your-github-handle"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
                  />
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)", mb: 1 }}>
                    Or test instantly with popular public accounts:
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                    {["facebook", "vercel", "shadcn", "fastapi"].map((u) => (
                      <Button
                        key={u}
                        type="button"
                        size="small"
                        variant="outlined"
                        onClick={() => handleQuickDemo(u)}
                        disabled={isSubmitting}
                        sx={{ fontSize: 12, py: 0.25, px: 1.25 }}
                      >
                        @{u}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              </Stack>
            ) : (
              <Stack spacing={2}>
                <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                  Connect with a GitHub Personal Access Token (classic or fine-grained) to load both private and organization repositories.
                </Typography>

                <Box>
                  <Typography component="label" htmlFor="gh-token" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                    GitHub Personal Access Token (PAT)
                  </Typography>
                  <TextField
                    id="gh-token"
                    type="password"
                    size="small"
                    fullWidth
                    autoComplete="off"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
                  />
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)", mt: 0.75 }}>
                    Requires <Box component="code" sx={{ fontFamily: "var(--font-mono)" }}>repo</Box> read scope. Tokens are encrypted and stored safely.
                  </Typography>
                </Box>
              </Stack>
            )}

            {error && (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  borderRadius: 1.5,
                  border: "1px solid rgba(239,68,68,0.25)",
                  bgcolor: "rgba(239,68,68,0.08)",
                  p: 1.5,
                  fontSize: 12.5,
                  color: "var(--destructive)",
                }}
              >
                <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span>{error}</span>
              </Stack>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
          <Button type="button" variant="outlined" size="small" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            size="small"
            disabled={isSubmitting || (tab === "quick" && !username.trim()) || (tab === "token" && !token.trim())}
            startIcon={<GitHubIcon size={14} />}
          >
            {isSubmitting ? "Connecting…" : "Connect Account"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
