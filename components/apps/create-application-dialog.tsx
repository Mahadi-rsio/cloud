"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { createApplicationSchema } from "@/lib/validators/application";
import {
  createApplication,
  FLY_REGIONS,
  type Application,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  buildRuntimeInput,
  emptyRuntimeFields,
  RuntimeFields,
  type RuntimeFieldsValue,
} from "./runtime-fields";

export function CreateApplicationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (application: Application) => void;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [fields, setFields] = useState<RuntimeFieldsValue>(
    emptyRuntimeFields,
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const runtime = buildRuntimeInput(fields);
      const input = createApplicationSchema.parse({
        name,
        ...(region ? { region } : {}),
        ...(runtime ? { runtime } : {}),
      });
      return createApplication(input);
    },
    onSuccess: ({ application }) => {
      onOpenChange(false);
      onCreated(application);
    },
    onError: (createError) => setError(extractErrorMessage(createError)),
  });

  useEffect(() => {
    if (open) {
      setName("");
      setRegion("");
      setFields(emptyRuntimeFields());
      setError(null);
      create.reset();
    }
  }, [open]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-base font-semibold text-foreground">
            Create app
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            Provision a new application on Fly. It gets a free shared IP and a
            public URL automatically — no dedicated IP or paid IPv6.
          </Dialog.Description>
          <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-name">Name</Label>
              <Input
                id="app-name"
                name="name"
                type="text"
                autoComplete="off"
                placeholder="my-app"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="app-region">Region</Label>
              <Select
                id="app-region"
                name="region"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
              >
                <option value="">Default (sin)</option>
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
                disabled={create.isPending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create app"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}