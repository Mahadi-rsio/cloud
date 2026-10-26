"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { updateApplicationSchema } from "@/lib/validators/application";
import {
  FLY_REGIONS,
  updateApplication,
  type Application,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit app</DialogTitle>
          <DialogDescription>
            Update {application.name}. Changing the runtime or region applies a
            new machine configuration.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              type="text"
              autoComplete="off"
              placeholder="my-app"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-region">Region</Label>
            <Select
              id="edit-region"
              name="region"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            >
              {FLY_REGIONS.map(({ code, name: regionName }) => (
                <option key={code} value={code}>
                  {regionName} ({code})
                </option>
              ))}
            </Select>
          </div>
          <RuntimeFields value={fields} onChange={setFields} />
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={edit.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={edit.isPending}>
              {edit.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}