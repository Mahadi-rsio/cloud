"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { deleteApplication, type Application } from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";

export function DeleteApplicationDialog({
  application,
  open,
  onOpenChange,
  onDeleted,
}: {
  application: Application;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: async () => deleteApplication(application.id),
    onSuccess: () => {
      setError(null);
      onOpenChange(false);
      onDeleted();
    },
    onError: (removeError) => setError(extractErrorMessage(removeError)),
  });

  const reset = () => {
    setError(null);
    remove.reset();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg">
          <Dialog.Title className="text-base font-semibold text-foreground">
            Delete app
          </Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-muted-foreground">
            This will destroy the Fly machine and app for{" "}
            <span className="font-medium text-foreground">{application.name}</span>{" "}
            and remove it from your list. This action cannot be undone.
          </Dialog.Description>
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
            >
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                setError(null);
                remove.mutate();
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete app"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}