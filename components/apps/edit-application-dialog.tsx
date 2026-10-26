"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-base font-semibold text-foreground">
            Edit app
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            Update {application.name}. Changing runtime or region applies the
            new machine configuration.
          </Dialog.Description>
          <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
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
                    {code} — {regionName}
                  </option>
                ))}
              </Select>
            </div>
            <RuntimeFields value={fields} onChange={setFields} />
            {error && (
              <p
                role="alert"
                className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
              >
                {error}
              </p>
            )}
            <div className="mt-1 flex justify-end gap-2">
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
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}