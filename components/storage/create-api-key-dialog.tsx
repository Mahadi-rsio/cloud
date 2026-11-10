"use client";

import * as React from "react";
import { Key, Copy, Check, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { createStorageApiKey, type StorageApiKey, type CreateApiKeyResult } from "@/lib/storage-client";
import { extractErrorMessage } from "@/lib/errors";

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (apiKey: StorageApiKey) => void;
}) {
  const [name, setName] = React.useState("");
  const [environment, setEnvironment] = React.useState<"live" | "test">("live");
  const [scopes, setScopes] = React.useState("storage:read,storage:write");
  const [expiration, setExpiration] = React.useState<string>("never");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Success state with secret key reveal
  const [createdResult, setCreatedResult] = React.useState<CreateApiKeyResult | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setEnvironment("live");
      setScopes("storage:read,storage:write");
      setExpiration("never");
      setError(null);
      setIsSubmitting(false);
      setCreatedResult(null);
      setCopied(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("API key name is required.");
      return;
    }

    let expiresInDays: number | undefined;
    if (expiration === "30") expiresInDays = 30;
    else if (expiration === "90") expiresInDays = 90;
    else if (expiration === "365") expiresInDays = 365;

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await createStorageApiKey({
        name: cleanName,
        environment,
        scopes,
        expiresInDays,
      });
      setCreatedResult(res);
      onSuccess(res.apiKey);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyKey = async () => {
    if (!createdResult?.secretKey) return;
    try {
      await navigator.clipboard.writeText(createdResult.secretKey);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = createdResult.secretKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {createdResult ? (
          // Step 2: Key created, reveal secret key
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                <ShieldCheck className="size-5" />
              </div>
              <DialogTitle>API Key Created</DialogTitle>
              <DialogDescription>
                Copy your secret API key now. For security, it will not be displayed again.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>
                Please store this key in a secure location (e.g. environment variable). You won't be able to retrieve it later.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold">Secret API Key</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={createdResult.secretKey}
                  className="font-mono text-xs bg-muted/50 select-all"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleCopyKey}
                >
                  {copied ? (
                    <>
                      <Check className="mr-1.5 size-4 text-emerald-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 size-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Usage with Authorization header:</p>
              <code className="rounded bg-muted p-2 font-mono text-[11px] text-foreground block overflow-x-auto">
                curl -H "Authorization: Bearer {createdResult.secretKey.slice(0, 10)}..." \
                <br />
                {"  "}{typeof window !== "undefined" ? window.location.origin : ""}/api/v1/storage/usage
              </code>
            </div>

            <DialogFooter className="mt-2">
              <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          // Step 1: Create Form
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Key className="size-5" />
              </div>
              <DialogTitle>Create Storage API Key</DialogTitle>
              <DialogDescription>
                Generate an API key to access storage buckets programmatically with REST or S3 tools.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. production-backend, backup-worker"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={isSubmitting}
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="key-env">Environment</Label>
                  <Select
                    id="key-env"
                    value={environment}
                    onChange={(e) => setEnvironment(e.target.value as "live" | "test")}
                    disabled={isSubmitting}
                  >
                    <option value="live">Live</option>
                    <option value="test">Test</option>
                  </Select>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="key-scopes">Permissions</Label>
                  <Select
                    id="key-scopes"
                    value={scopes}
                    onChange={(e) => setScopes(e.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value="storage:read,storage:write">Read & Write</option>
                    <option value="storage:read">Read Only</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="key-exp">Expiration</Label>
                <Select
                  id="key-exp"
                  value={expiration}
                  onChange={(e) => setExpiration(e.target.value)}
                  disabled={isSubmitting}
                >
                  <option value="never">Never expires</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year (365 days)</option>
                </Select>
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
                    Generating...
                  </>
                ) : (
                  "Generate Key"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
