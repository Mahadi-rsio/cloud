"use client";

import * as React from "react";
import {
  ShieldCheck,
  Loader2,
  AlertCircle,
  Sparkles,
  ArrowRight,
} from "lucide-react";
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
import { CopyField } from "@/components/shared/copy-field";
import {
  authRuntimeUrl,
  createAuthProject,
  type AuthProjectItem,
} from "@/lib/auth-projects/client";
import { extractErrorMessage } from "@/lib/errors";

export function CreateAuthProjectDialog({
  open,
  onOpenChange,
  onSuccess,
  onOpenConnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (project: AuthProjectItem) => void;
  onOpenConnect?: (project: AuthProjectItem) => void;
}) {
  const [name, setName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<AuthProjectItem | null>(null);

  React.useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setIsSubmitting(false);
      setCreated(null);
    }
  }, [open]);

  const previewSlug = React.useMemo(() => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 16);
    return slug || "auth";
  }, [name]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();

    if (cleanName.length < 2 || cleanName.length > 64) {
      setError("Project name must be between 2 and 64 characters.");
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const project = await createAuthProject({ name: cleanName });
      setCreated(project);
      onSuccess(project);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (created) {
    const baseUrl = authRuntimeUrl();
    const quickstart = `import { createAuthClient } from "better-auth/client";

const authClient = createAuthClient({
  baseURL: "${baseUrl}",
  fetchOptions: {
    headers: { "x-publishable-key": "${created.publishableKey}" },
    credentials: "include",
  },
});`;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-5" />
            </div>
            <DialogTitle>Auth project created</DialogTitle>
            <DialogDescription>
              Email + password auth is live on a dedicated SQLite namespace.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
              <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                <span>Project</span>
                <span className="font-semibold text-foreground">{created.name}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                <span>Namespace</span>
                <span className="font-mono text-foreground">{created.namespace}</span>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Auth base URL</span>
                <CopyField
                  value={baseUrl}
                  className="rounded bg-background px-2 py-1 border"
                />
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Publishable key</span>
                <CopyField
                  value={created.publishableKey}
                  className="rounded bg-background px-2 py-1 border"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold">Client setup</Label>
              <pre className="max-h-52 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                {quickstart}
              </pre>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            {onOpenConnect && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  onOpenChange(false);
                  onOpenConnect(created);
                }}
              >
                Connection Guide
                <ArrowRight className="size-3.5" />
              </Button>
            )}
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <DialogTitle>Create Auth Project</DialogTitle>
            <DialogDescription>
              Provision a managed Better Auth backend with a dedicated SQLite
              database.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="auth-project-name">Project Name</Label>
              <Input
                id="auth-project-name"
                placeholder="e.g. my-saas, production-auth"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Namespace preview:{" "}
                <span className="font-mono text-foreground font-medium">
                  {previewSlug}_[id]
                </span>
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <DialogFooter>
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
                  Provisioning...
                </>
              ) : (
                "Create Auth Project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
