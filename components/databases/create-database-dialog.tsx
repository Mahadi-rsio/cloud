"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { Database } from "lucide-react";
import { createDatabase, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";

const REGIONS = [{ value: "iad", label: "US East (iad)" }];
const DB_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function CreateDatabaseDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (db: DatabaseItem) => void;
}) {
  const [name, setName] = React.useState("");
  const [region, setRegion] = React.useState("iad");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setRegion("iad");
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().toLowerCase();

    if (!cleanName) {
      setError("Database name is required.");
      return;
    }

    if (cleanName.length < 3 || cleanName.length > 32) {
      setError("Database name must be between 3 and 32 characters.");
      return;
    }

    if (!DB_NAME_REGEX.test(cleanName)) {
      setError(
        "Use lowercase letters, numbers, and hyphens only (must start and end with a letter or number).",
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const created = await createDatabase({
        name: cleanName,
        region,
      });
      onOpenChange(false);
      onSuccess(created);
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
      slotProps={{
        paper: {
          sx: {
            width: "100%",
            maxWidth: { xs: "100%", sm: 440 },
            m: { xs: 0, sm: 2 },
            alignSelf: { xs: "flex-end", sm: "center" },
            borderRadius: { xs: "16px 16px 0 0", sm: "14px" },
          },
        },
      }}
    >
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1.5, display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box
            sx={{
              display: "inline-flex",
              width: 34,
              height: 34,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "color-mix(in oklab, var(--primary) 12%, transparent)",
              color: "var(--primary)",
              flexShrink: 0,
            }}
          >
            <Database size={18} />
          </Box>
          <Typography variant="h6" component="span" sx={{ fontWeight: 600, fontSize: "1.05rem" }}>
            Create database
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <TextField
            autoFocus
            label="Database name"
            size="small"
            fullWidth
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase());
              if (error) setError(null);
            }}
            placeholder="my-app-db"
            disabled={isSubmitting}
            helperText="Lowercase letters, numbers, and hyphens (3-32 chars)"
            slotProps={{
              htmlInput: {
                maxLength: 32,
                autoCapitalize: "none",
                autoCorrect: "off",
                spellCheck: false,
              },
            }}
          />

          <TextField
            select
            label="Region"
            size="small"
            fullWidth
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={isSubmitting}
          >
            {REGIONS.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>

        <DialogActions
          sx={{
            px: 3,
            pb: { xs: "calc(20px + env(safe-area-inset-bottom, 0px))", sm: 2.5 },
            pt: 1,
            gap: 1,
          }}
        >
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
            startIcon={isSubmitting ? <CircularProgress size={15} color="inherit" /> : undefined}
          >
            {isSubmitting ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
