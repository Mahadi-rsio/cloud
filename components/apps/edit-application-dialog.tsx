"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { updateApplicationSchema } from "@/lib/validators/application";
import {
  FLY_REGIONS,
  updateApplication,
  type Application,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import {
  buildRuntimeInput,
  runtimeFieldsFromApplication,
  RuntimeFields,
  type RuntimeFieldsValue,
} from "./runtime-fields";

export function EditApplicationDialog({
  application,
  open,
  onOpenChange,
  onUpdated,
}: {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(application.name);
  const [region, setRegion] = useState(application.region);
  const [fields, setFields] = useState<RuntimeFieldsValue>(() =>
    runtimeFieldsFromApplication(application),
  );
  const [error, setError] = useState<string | null>(null);

  const edit = useMutation({
    mutationFn: async () => {
      const runtime = buildRuntimeInput(fields);
      const input = updateApplicationSchema.parse({
        name,
        ...(region ? { region } : {}),
        ...(runtime ? { runtime } : {}),
      });
      return updateApplication(application.id, input);
    },
    onSuccess: () => {
      onOpenChange(false);
      onUpdated();
    },
    onError: (editError) => setError(extractErrorMessage(editError)),
  });

  useEffect(() => {
    if (open) {
      setName(application.name);
      setRegion(application.region);
      setFields(runtimeFieldsFromApplication(application));
      setError(null);
      edit.reset();
    }
  }, [open, application]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    edit.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={() => !edit.isPending && onOpenChange(false)}
      fullWidth
      maxWidth="xs"
    >
      <Box component="form" onSubmit={submit}>
        <DialogTitle>Edit app</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <DialogContentText>
            Update {application.name}. Changing the runtime or region applies a
            new machine configuration.
          </DialogContentText>
          <TextField
            id="edit-name"
            name="name"
            label="Name"
            type="text"
            size="small"
            fullWidth
            autoComplete="off"
            placeholder="my-app"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            id="edit-region"
            name="region"
            label="Region"
            select
            size="small"
            fullWidth
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            {FLY_REGIONS.map(({ code, name: regionName }) => (
              <MenuItem key={code} value={code}>
                {regionName} ({code})
              </MenuItem>
            ))}
          </TextField>
          <RuntimeFields value={fields} onChange={setFields} />
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            type="button"
            variant="outlined"
            disabled={edit.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={edit.isPending}>
            {edit.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
