"use client";

import * as React from "react";
import { Database, Check, Copy, Loader2, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
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

  // Success reveal state
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

  // If successfully created, show credentials confirmation view
  if (createdDb) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-5" />
            </div>
            <DialogTitle>Database Created Successfully</DialogTitle>
            <DialogDescription>
              Your new distributed libSQL database is provisioned and ready for connections.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
              <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                <span>Database Name</span>
                <span className="font-semibold text-foreground">{createdDb.name}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                <span>Namespace</span>
                <span className="font-mono text-foreground">{createdDb.namespace}</span>
              </div>
              <div className="flex justify-between items-center text-xs text-muted-foreground border-b pb-2">
                <span>Region</span>
                <span className="text-foreground">{createdDb.region.toUpperCase()} (US East)</span>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Connection URL</span>
                <CopyField
                  value={createdDb.libsqlUrl}
                  className="rounded bg-background px-2 py-1 border"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold">Primary Auth Token</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type="password"
                  value={createdDb.defaultToken}
                  className="font-mono text-xs selection:bg-primary/20"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyToken}
                  className="shrink-0 gap-1.5"
                >
                  {copiedToken ? (
                    <>
                      <Check className="size-3.5 text-emerald-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      Copy Token
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Keep this token safe. It grants full read/write access to this database namespace.
              </p>
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
                  onOpenConnect(createdDb);
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
              <Database className="size-5" />
            </div>
            <DialogTitle>Create Database</DialogTitle>
            <DialogDescription>
              Deploy a new ultra-fast libSQL database with instant global replication.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="db-name">Database Name</Label>
              <Input
                id="db-name"
                placeholder="e.g. production-db, analytics, myapp"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isSubmitting}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Domain preview:{" "}
                <span className="font-mono text-foreground font-medium">
                  {previewSlug}_[id]_cdb.cloudisy.top
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="db-region">Primary Region</Label>
              <Select
                id="db-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                disabled={isSubmitting}
              >
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Primary writer instance region. Read replicas can sync globally.
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
                  Creating...
                </>
              ) : (
                "Create Database"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
