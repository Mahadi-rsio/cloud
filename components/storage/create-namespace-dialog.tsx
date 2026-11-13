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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { FolderPlus } from "lucide-react";
import { createStorageNamespace, type StorageNamespace } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

const NAME_REGEX = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;

export function CreateNamespaceDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (namespace: StorageNamespace) => void;
}) {
  const [name, setName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim().toLowerCase();

    if (!clean) {
      setError("Storage name is required.");
      return;
    }

    if (clean.length < 3 || clean.length > 63) {
      setError("Storage name must be between 3 and 63 characters.");
      return;
    }

    if (!NAME_REGEX.test(clean)) {
      setError(
        "Storage name must start and end with a lowercase letter or number, and can only contain lowercase letters, numbers, hyphens, and dots."
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const created = await createStorageNamespace(clean);
      onSuccess(created);
      onOpenChange(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !isSubmitting && onOpenChange(false)}
      fullWidth
      maxWidth="xs"
    >
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
            <FolderPlus size={20} />
          </Box>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            Create Storage
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Create an isolated storage bucket namespace for your files, assets, or backups.
          </DialogContentText>

          <TextField
            id="namespace-name"
            label="Storage Name"
            size="small"
            fullWidth
            placeholder="e.g. assets, user-uploads, backups"
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase());
              if (error) setError(null);
            }}
            disabled={isSubmitting}
            autoFocus
            helperText="Lowercase letters, numbers, hyphens, and dots (3-63 characters)."
          />

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
            {isSubmitting ? "Creating..." : "Create Storage"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
