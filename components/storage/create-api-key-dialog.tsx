"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Key, Copy, Check, ShieldCheck } from "lucide-react";
import { createStorageApiKey, type StorageApiKey, type CreateApiKeyResult } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (apiKey: StorageApiKey) => void;
}) {
  const [name, setName] = React.useState("");
  const [environment, setEnvironment] = React.useState<"live" | "test">("live");
  const [scopes, setScopes] = React.useState("storage:read,storage:write");
  const [expiration, setExpiration] = React.useState<string>("never");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [createdResult, setCreatedResult] = React.useState<CreateApiKeyResult | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setEnvironment("live");
      setScopes("storage:read,storage:write");
      setExpiration("never");
      setError(null);
      setIsSubmitting(false);
      setCreatedResult(null);
      setCopied(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("API key name is required.");
      return;
    }

    let expiresInDays: number | undefined;
    if (expiration === "30") expiresInDays = 30;
    else if (expiration === "90") expiresInDays = 90;
    else if (expiration === "365") expiresInDays = 365;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await createStorageApiKey({
        name: cleanName,
        environment,
        scopes,
        expiresInDays,
      });
      setCreatedResult(res);
      onSuccess(res.apiKey);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyKey = async () => {
    if (!createdResult?.secretKey) return;
    try {
      await navigator.clipboard.writeText(createdResult.secretKey);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = createdResult.secretKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onClose={() => !isSubmitting && onOpenChange(false)}
      fullWidth
      maxWidth="xs"
    >
      {createdResult ? (
        <>
          <DialogTitle sx={{ pb: 1 }}>
            <Box
              sx={{
                mb: 1.5,
                display: "inline-flex",
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "8px",
                backgroundColor: "rgba(61, 214, 140, 0.12)",
                color: "#3dd68c",
              }}
            >
              <ShieldCheck size={20} />
            </Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
              API Key Created
            </Typography>
          </DialogTitle>

          <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DialogContentText>
              Copy your secret API key now. For security, it will not be displayed again.
            </DialogContentText>

            <Alert severity="warning" sx={{ fontSize: "0.75rem" }}>
              Please store this key in a secure location (e.g. environment variable). You won't be able to retrieve it later.
            </Alert>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Secret API Key
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <TextField
                  size="small"
                  fullWidth
                  value={createdResult.secretKey}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: "var(--font-mono)", fontSize: "0.75rem" },
                    },
                  }}
                />
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={handleCopyKey}
                  startIcon={
                    copied ? <Check size={14} color="#3dd68c" /> : <Copy size={14} />
                  }
                  sx={{ flexShrink: 0 }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </Box>
            </Box>

            <Divider />

            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                Usage with Authorization header:
              </Typography>
              <Paper
                variant="outlined"
                sx={{
                  p: 1,
                  backgroundColor: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  overflowX: "auto",
                }}
              >
                curl -H "Authorization: Bearer {createdResult.secretKey.slice(0, 10)}..." \
                <br />
                {"  "}{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/storage/usage
              </Paper>
            </Box>
          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button type="button" variant="contained" fullWidth onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={handleSubmit}>
          <DialogTitle sx={{ pb: 1 }}>
            <Box
              sx={{
                mb: 1.5,
                display: "inline-flex",
                width: 40,
                height: 40,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "8px",
                backgroundColor: "rgba(56, 189, 248, 0.12)",
                color: "var(--primary)",
              }}
            >
              <Key size={20} />
            </Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
              Create Storage API Key
            </Typography>
          </DialogTitle>

          <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <DialogContentText>
              Generate an API key to access storage buckets programmatically with REST or S3 tools.
            </DialogContentText>

            <TextField
              id="key-name"
              label="Key Name"
              size="small"
              fullWidth
              placeholder="e.g. production-backend, backup-worker"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              disabled={isSubmitting}
              autoFocus
            />

            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
              <TextField
                id="key-env"
                label="Environment"
                select
                size="small"
                fullWidth
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as "live" | "test")}
                disabled={isSubmitting}
              >
                <MenuItem value="live">Live</MenuItem>
                <MenuItem value="test">Test</MenuItem>
              </TextField>

              <TextField
                id="key-scopes"
                label="Permissions"
                select
                size="small"
                fullWidth
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                disabled={isSubmitting}
              >
                <MenuItem value="storage:read,storage:write">Read & Write</MenuItem>
                <MenuItem value="storage:read">Read Only</MenuItem>
              </TextField>
            </Box>

            <TextField
              id="key-exp"
              label="Expiration"
              select
              size="small"
              fullWidth
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
              disabled={isSubmitting}
            >
              <MenuItem value="never">Never expires</MenuItem>
              <MenuItem value="30">30 days</MenuItem>
              <MenuItem value="90">90 days</MenuItem>
              <MenuItem value="365">1 year (365 days)</MenuItem>
            </TextField>

            {error && <Alert severity="error">{error}</Alert>}
          </DialogContent>

          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button
              type="button"
              variant="outlined"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={isSubmitting || !name.trim()}
              startIcon={isSubmitting ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {isSubmitting ? "Generating..." : "Generate Key"}
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}
