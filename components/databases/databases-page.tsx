"use client";

import * as React from "react";
import {
  Database,
  Plus,
  Search,
  RefreshCw,
  Code2,
  Trash2,
  MoreHorizontal,
  ExternalLink,
  ShieldCheck,
  Server,
  KeyRound,
  Check,
  Copy,
  Table,
  Activity,
  HardDrive,
  ArrowUpRight,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateDatabaseDialog } from "./create-database-dialog";
import { ConnectDatabaseDialog } from "./connect-database-dialog";
import { DatabaseStudioDialog } from "./database-studio-dialog";
import {
  listDatabases,
  deleteDatabase,
  type DatabaseItem,
} from "@/lib/databases/client";
import { formatBytes } from "@/lib/storage-client";
import { cn } from "@/lib/utils";
import { extractErrorMessage } from "@/lib/errors";

const FREE_PLAN_LIMITS = {
  rowsRead: 1_000_000,
  rowsWritten: 100_000,
  storageBytes: 512 * 1024 * 1024, // 512 MB
};

export function DatabasesPage() {
  const [databases, setDatabases] = React.useState<DatabaseItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  // Dialog states
  const [createOpen, setCreateOpen] = React.useState(false);
  const [connectDb, setConnectDb] = React.useState<DatabaseItem | null>(null);
  const [studioDb, setStudioDb] = React.useState<DatabaseItem | null>(null);
  const [deleteDb, setDeleteDb] = React.useState<DatabaseItem | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Copied token tracker for inline copy buttons
  const [copiedTokenId, setCopiedTokenId] = React.useState<string | null>(null);

  const loadDatabases = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listDatabases();
      setDatabases(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const handleCopyToken = async (db: DatabaseItem) => {
    try {
      await navigator.clipboard.writeText(db.defaultToken);
      setCopiedTokenId(db.id);
      setTimeout(() => setCopiedTokenId(null), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = db.defaultToken;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedTokenId(db.id);
      setTimeout(() => setCopiedTokenId(null), 2000);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDb) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteDatabase(deleteDb.id);
      setDatabases((prev) => prev.filter((d) => d.id !== deleteDb.id));
      setDeleteDb(null);
    } catch (err) {
      setDeleteError(extractErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDatabases = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return databases;
    return databases.filter(
      (db) =>
        db.name.toLowerCase().includes(q) ||
        db.namespace.toLowerCase().includes(q) ||
        db.region.toLowerCase().includes(q),
    );
  }, [databases, searchQuery]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Databases"
        description="Serverless, distributed libSQL & SQLite databases with zero cold starts, replication, and instant branching."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadDatabases()}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              Create Database
            </Button>
          </div>
        }
      />

      {/* Info / Quick Stats bar */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Active Databases</span>
            <span className="text-lg font-semibold">{databases.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Server className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Engine & Protocol</span>
            <span className="text-lg font-semibold">libSQL / SQLite</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Auth & Encryption</span>
            <span className="text-lg font-semibold">Ed25519 JWT + TLS</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search databases by name or namespace..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading && databases.length === 0 ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-muted bg-muted/20"
            />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Failed to load databases"
          description={error}
          onRetry={() => void loadDatabases()}
        />
      ) : databases.length === 0 ? (
        <EmptyState
          icon={<Database className="size-6" />}
          title="No databases found"
          description="You haven't created any databases yet. Create your first libSQL database in seconds."
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Create Database
            </Button>
          }
        />
      ) : filteredDatabases.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="No matching databases"
          description={`No database found matching "${searchQuery}".`}
          action={
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredDatabases.map((db) => {
            const hasCopiedToken = copiedTokenId === db.id;
            const stats = db.stats;
            const rowsRead = stats?.rowsReadCount ?? 0;
            const rowsWritten = stats?.rowsWrittenCount ?? 0;
            const storageBytes = stats?.storageBytesUsed ?? 0;
            const queryCount = stats?.queryCount ?? 0;

            const readPercent = Math.min(
              100,
              parseFloat(((rowsRead / FREE_PLAN_LIMITS.rowsRead) * 100).toFixed(1)),
            );
            const writePercent = Math.min(
              100,
              parseFloat(((rowsWritten / FREE_PLAN_LIMITS.rowsWritten) * 100).toFixed(1)),
            );
            const storagePercent = Math.min(
              100,
              parseFloat(((storageBytes / FREE_PLAN_LIMITS.storageBytes) * 100).toFixed(1)),
            );

            return (
              <div
                key={db.id}
                className="flex flex-col rounded-xl border bg-card p-5 shadow-2xs transition-all hover:border-foreground/20 gap-4"
              >
                <div className="flex flex-col justify-between sm:flex-row sm:items-center gap-4">
                  <div className="flex flex-col gap-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Database className="size-4" />
                      </div>
                      <span className="font-semibold text-foreground text-base truncate">
                        {db.name}
                      </span>
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {db.namespace}
                      </span>
                      <StatusBadge status={db.status} />
                      <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                        {db.region.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 font-medium text-foreground">URL:</span>
                        <CopyField
                          value={db.libsqlUrl}
                          className="rounded bg-muted/40 px-2 py-0.5 max-w-xs sm:max-w-md"
                        />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span>Created</span>
                        <RelativeTime value={db.createdAt} className="font-medium" />
                      </div>
                    </div>
                  </div>

                  {/* Database Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => setStudioDb(db)}
                      className="gap-1.5 shadow-2xs"
                    >
                      <Table className="size-3.5" />
                      Studio
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConnectDb(db)}
                      className="gap-1.5"
                    >
                      <Code2 className="size-3.5" />
                      Connect
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopyToken(db)}
                      className="gap-1 text-xs"
                      title="Copy Primary Auth Token"
                    >
                      {hasCopiedToken ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <KeyRound className="size-3.5" />
                          Token
                        </>
                      )}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="size-8">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => setStudioDb(db)}>
                          <Table className="mr-2 size-4 text-primary" />
                          Explore Data (Studio)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setConnectDb(db)}>
                          <Code2 className="mr-2 size-4" />
                          Connection Guide
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleCopyToken(db)}>
                          <KeyRound className="mr-2 size-4" />
                          Copy Auth Token
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void navigator.clipboard.writeText(db.libsqlUrl);
                          }}
                        >
                          <Copy className="mr-2 size-4" />
                          Copy LibSQL URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void navigator.clipboard.writeText(db.httpUrl);
                          }}
                        >
                          <ExternalLink className="mr-2 size-4" />
                          Copy HTTP URL
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteDb(db);
                          }}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete Database
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Usage & Metering (Free Tier: 1M reads, 100k writes, 512MB storage) */}
                <div className="rounded-lg border bg-muted/15 p-3.5">
                  <div className="flex items-center justify-between text-xs font-medium mb-2.5 flex-wrap gap-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Activity className="size-3.5 text-primary" />
                      <span>Monthly Usage & Quotas</span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        FREE TIER
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {queryCount.toLocaleString()} queries processed
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    {/* Rows Read */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Rows Read</span>
                        <span className="font-mono font-medium text-foreground">
                          {rowsRead.toLocaleString()}{" "}
                          <span className="text-muted-foreground font-normal">
                            / 1M ({readPercent}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/80 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            readPercent >= 100
                              ? "bg-red-500"
                              : readPercent > 80
                                ? "bg-amber-500"
                                : "bg-primary",
                          )}
                          style={{
                            width: `${Math.max(readPercent > 0 ? 2 : 0, readPercent)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Rows Written */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Rows Written</span>
                        <span
                          className={cn(
                            "font-mono font-medium",
                            writePercent > 80 ? "text-amber-500" : "text-foreground",
                          )}
                        >
                          {rowsWritten.toLocaleString()}{" "}
                          <span className="text-muted-foreground font-normal">
                            / 100k ({writePercent}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/80 overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            writePercent >= 100
                              ? "bg-red-500"
                              : writePercent > 80
                                ? "bg-amber-500"
                                : "bg-emerald-500",
                          )}
                          style={{
                            width: `${Math.max(writePercent > 0 ? 2 : 0, writePercent)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Storage */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Disk Storage</span>
                        <span className="font-mono font-medium text-foreground">
                          {formatBytes(storageBytes)}{" "}
                          <span className="text-muted-foreground font-normal">
                            / 512 MB ({storagePercent}%)
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/80 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all"
                          style={{
                            width: `${Math.max(storagePercent > 0 ? 2 : 0, storagePercent)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <CreateDatabaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(newDb) => {
          setDatabases((prev) => [newDb, ...prev]);
        }}
        onOpenConnect={(newDb) => {
          setConnectDb(newDb);
        }}
      />

      {/* Connect Guide Dialog */}
      <ConnectDatabaseDialog
        database={connectDb}
        open={Boolean(connectDb)}
        onOpenChange={(open) => {
          if (!open) setConnectDb(null);
        }}
      />

      {/* LibSQL Studio GUI Dialog */}
      <DatabaseStudioDialog
        database={studioDb}
        open={Boolean(studioDb)}
        onOpenChange={(open) => {
          if (!open) setStudioDb(null);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDeleteDialog
        open={Boolean(deleteDb)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDb(null);
            setDeleteError(null);
          }
        }}
        title={`Delete "${deleteDb?.name}"?`}
        description={
          <div className="flex flex-col gap-2">
            <span>
              This will permanently delete database{" "}
              <strong className="text-foreground">{deleteDb?.name}</strong> and all associated
              tables, data, and access keys. This action cannot be undone.
            </span>
            {deleteError && (
              <span className="rounded bg-destructive/10 p-2 text-xs text-destructive">
                {deleteError}
              </span>
            )}
          </div>
        }
        confirmText={deleteDb?.name}
        confirmLabel={isDeleting ? "Deleting..." : "Delete Database"}
        isPending={isDeleting}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
}
