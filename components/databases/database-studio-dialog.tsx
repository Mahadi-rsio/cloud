"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Loader2, Table, X, ExternalLink, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DatabaseItem } from "@/lib/databases/client";

// Dynamically import DatabaseStudioView with ssr: false
const DatabaseStudioView = dynamic(
  () => import("./database-studio-view"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[75vh] w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm">Connecting to libSQL Studio GUI...</p>
      </div>
    ),
  },
);

interface DatabaseStudioDialogProps {
  database: DatabaseItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DatabaseStudioDialog({
  database,
  open,
  onOpenChange,
}: DatabaseStudioDialogProps) {
  if (!database) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed inset-2 sm:inset-6 z-50 flex max-w-none flex-col overflow-hidden rounded-xl border bg-background p-0 shadow-2xl transition-all">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Table className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground text-sm sm:text-base">
                  {database.name}
                </h3>
                <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                  {database.namespace}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
                  <ShieldCheck className="size-3" />
                  Secured
                </span>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                libSQL Studio GUI &bull; Query editor, table explorer, and schema manager
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="gap-1 text-xs"
            >
              <X className="size-4" />
              Close
            </Button>
          </div>
        </div>

        {/* Studio Content */}
        <div className="relative flex-1 w-full overflow-hidden bg-background">
          <DatabaseStudioView
            database={database}
            theme="dark"
            onClose={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
