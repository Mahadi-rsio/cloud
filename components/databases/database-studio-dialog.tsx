"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Loader2, Table, X, ExternalLink, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DatabaseItem } from "@/lib/databases/client";

// Dynamically import DatabaseStudioView with ssr: false
const DatabaseStudioView = dynamic(
  () => import("./database-studio-view"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[300px] w-full flex-col items-center justify-center gap-3 text-muted-foreground p-6">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Connecting to libSQL Studio GUI...</p>
        <p className="text-xs text-muted-foreground">Initializing driver and schema cache</p>
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
      <DialogContent className="fixed inset-0 sm:inset-3 md:inset-6 left-0 top-0 translate-x-0 translate-y-0 w-screen sm:w-auto h-screen sm:h-auto max-w-none flex flex-col overflow-hidden rounded-none sm:rounded-xl border bg-background p-0 shadow-2xl transition-all z-50 [&>button:last-child]:hidden">
        {/* Responsive Header */}
        <div className="flex items-center justify-between border-b px-3 sm:px-4 py-2.5 sm:py-3 bg-muted/40 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex size-7 sm:size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Table className="size-3.5 sm:size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h3 className="font-semibold text-foreground text-sm sm:text-base truncate max-w-[120px] sm:max-w-[200px] md:max-w-[320px]">
                  {database.name}
                </h3>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground truncate max-w-[110px] sm:max-w-[160px]">
                  {database.namespace}
                </span>
                <span className="hidden md:inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
                  <ShieldCheck className="size-3" />
                  Secured
                </span>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block truncate">
                libSQL Studio GUI &bull; Query editor, table explorer, and schema manager
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs px-2 sm:px-3"
            >
              <Link
                href={`/databases/${database.id}/studio`}
                target="_blank"
                rel="noreferrer"
                title="Open Studio in new dedicated tab"
              >
                <ExternalLink className="size-3.5" />
                <span className="hidden sm:inline">Open Fullscreen</span>
              </Link>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 gap-1 text-xs px-2 sm:px-3 hover:bg-destructive/10 hover:text-destructive"
              title="Close Studio dialog"
            >
              <X className="size-4" />
              <span className="hidden sm:inline">Close</span>
            </Button>
          </div>
        </div>

        {/* Studio Body */}
        <div className="relative flex-1 w-full min-h-0 overflow-hidden bg-background">
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
