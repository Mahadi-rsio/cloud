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
import { Database, Check, Copy, Sparkles, ArrowRight } from "lucide-react";
import { CopyField } from "@/components/shared/copy-field";
import { createDatabase, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";

const REGIONS = [
  { value: "iad", label: "US East (Virginia) - iad" },
];

export function CreateDatabaseDialog({
  open,
  onOpenChange,
  onSuccess,
  onOpenConnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (db: DatabaseItem) => void;
  onOpenConnect?: (db: DatabaseItem) => void;
}) {
  const [name, setName] = React.useState("");
  const [region, setRegion] = React.useState("iad");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [createdDb, setCreatedDb] = React.useState<DatabaseItem | null>(null);
  const [copiedToken, setCopiedToken] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setRegion("iad");
      setError(null);
      setIsSubmitting(false);
      setCreatedDb(null);
      setCopiedToken(false);
    }
  }, [open]);

  const previewSlug = React.useMemo(() => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 16);
    return slug || "db";
  }, [name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();

    if (!cleanName) {
      setError("Database name is required.");
      return;
    }

    if (cleanName.length < 2 || cleanName.length > 48) {
      setError("Database name must be between 2 and 48 characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await createDatabase({
        name: cleanName,
        region,
      });
      setCreatedDb(res);
      onSuccess(res);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyToken = async () => {
    if (!createdDb?.defaultToken) return;
    try {
      await navigator.clipboard.writeText(createdDb.defaultToken);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = createdDb.defaultToken;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  if (createdDb) {
    return (
      <Dialog open={open} onClose={() => onOpenChange(false)} fullWidth maxWidth="sm">
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
            <Sparkles size={20} />
          </Box>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            Database Created Successfully
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Your new distributed libSQL database is provisioned and ready for connections.
          </DialogContentText>

          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              borderRadius: "10px",
              backgroundColor: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              gap: 1.25,
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                Database Name
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {createdDb.name}
              </Typography>
            </Box>
            <Divider />
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                Namespace
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)" }}>
                {createdDb.namespace}
              </Typography>
            </Box>
            <Divider />
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                Region
              </Typography>
              <Typography variant="caption">
                {createdDb.region.toUpperCase()} (US East)
              </Typography>
            </Box>
            <Divider />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Connection URL
              </Typography>
              <CopyField
                value={createdDb.libsqlUrl}
                sx={{
                  borderRadius: "6px",
                  backgroundColor: "var(--background)",
                  px: 1,
                  py: 0.5,
                  border: "1px solid var(--border)",
                }}
              />
            </Box>
          </Paper>

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Primary Auth Token
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <TextField
                size="small"
                fullWidth
                type="password"
                value={createdDb.defaultToken}
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
                onClick={handleCopyToken}
                startIcon={
                  copiedToken ? (
                    <Check size={14} color="#3dd68c" />
                  ) : (
                    <Copy size={14} />
                  )
                }
                sx={{ flexShrink: 0 }}
              >
                {copiedToken ? "Copied" : "Copy Token"}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Keep this token safe. It grants full read/write access to this database namespace.
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {onOpenConnect && (
            <Button
              type="button"
              variant="outlined"
              endIcon={<ArrowRight size={14} />}
              onClick={() => {
                onOpenChange(false);
                onOpenConnect(createdDb);
              }}
            >
              Connection Guide
            </Button>
          )}
          <Button type="button" variant="contained" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

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
            <Database size={20} />
          </Box>
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            Create Database
          </Typography>
        </DialogTitle>

        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Deploy a new ultra-fast libSQL database with instant global replication.
          </DialogContentText>

          <TextField
            id="db-name"
            label="Database Name"
            size="small"
            fullWidth
            placeholder="e.g. production-db, analytics, myapp"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            disabled={isSubmitting}
            autoFocus
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false } }}
            helperText={
              <>
                Domain preview:{" "}
                <Box
                  component="span"
                  sx={{ fontFamily: "var(--font-mono)", color: "var(--foreground)", fontWeight: 500 }}
                >
                  {previewSlug}-[id].cloudisy.top
                </Box>
              </>
            }
          />

          <TextField
            id="db-region"
            label="Primary Region"
            select
            size="small"
            fullWidth
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={isSubmitting}
            helperText="Primary writer instance region. Read replicas can sync globally."
          >
            {REGIONS.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
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
            {isSubmitting ? "Creating..." : "Create Database"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
