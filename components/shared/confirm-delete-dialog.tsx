"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AlertTriangle } from "lucide-react";

/** Destructive confirmation dialog. When `confirmText` is provided the user
 * must type it exactly before the destructive action is enabled. */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel = "Delete",
  isPending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  const requiresText = Boolean(confirmText);
  const canConfirm = !requiresText || typed === confirmText;

  return (
    <Dialog
      open={open}
      onClose={() => !isPending && onOpenChange(false)}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box
          sx={{
            mb: 1.5,
            display: "inline-flex",
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
            backgroundColor: "rgba(229, 72, 77, 0.12)",
            color: "var(--destructive)",
          }}
        >
          <AlertTriangle size={20} />
        </Box>
        <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <DialogContentText component="div">{description}</DialogContentText>
        {requiresText && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography component="label" htmlFor="confirm-input" variant="body2" sx={{ fontWeight: 600 }}>
              Type{" "}
              <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
                {confirmText}
              </Box>{" "}
              to confirm
            </Typography>
            <TextField
              id="confirm-input"
              size="small"
              fullWidth
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={confirmText}
              autoComplete="off"
              slotProps={{ htmlInput: { spellCheck: false } }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          type="button"
          variant="outlined"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={!canConfirm || isPending}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
