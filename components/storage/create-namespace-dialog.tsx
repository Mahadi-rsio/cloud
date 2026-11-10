"use client";

import * as React from "react";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderPlus className="size-5" />
            </div>
            <DialogTitle>Create Storage</DialogTitle>
            <DialogDescription>
              Create an isolated storage bucket namespace for your files, assets, or backups.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="namespace-name">Storage Name</Label>
              <Input
                id="namespace-name"
                placeholder="e.g. assets, user-uploads, backups"
                value={name}
                onChange={(e) => {
                  setName(e.target.value.toLowerCase());
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, hyphens, and dots (3-63 characters).
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Storage"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
