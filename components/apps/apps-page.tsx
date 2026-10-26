"use client";

import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AppWindow,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  listApplications,
  type Application,
  type ApplicationStatus,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { appUrl } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyField } from "@/components/shared/copy-field";
import { RelativeTime } from "@/components/shared/relative-time";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { formatGuestSize, regionName } from "@/components/apps/format";

const LIST_PAGE_SIZE = 20;

function RowActions({
  app,
  onDelete,
}: {
  app: Application;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Actions for ${app.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={appUrl(app.slug)} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            Open
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Application[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("");
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async (pageCursor: string | null, replace: boolean) => {
    try {
      setError(null);
      if (replace) setIsLoading(true);
      const page = await listApplications({
        cursor: pageCursor,
        limit: LIST_PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      if (replace) {
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } else {
        setItems((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      if (replace) setIsLoading(false);
    }
  };

  useEffect(() => {
    void load(null, true);
  }, [statusFilter]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter(
      (app) =>
        app.name.toLowerCase().includes(query) ||
        app.slug.toLowerCase().includes(query)
    );
  }, [items, search]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const { deleteApplication } = await import("@/lib/applications");
      await deleteApplication(deleteTarget.id);
      setDeleteTarget(null);
      void load(null, true);
    } catch (deleteError) {
      setError(extractErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Apps"
        description="Deploy backend apps from a Docker image or a GitHub repo. Each app gets a public URL."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void load(null, true)}
            >
              <RefreshCw />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/apps/new">
                <Plus />
                New app
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search apps…"
            aria-label="Search apps"
            className="pl-9"
          />
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <Select
            className="w-full sm:w-44"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as ApplicationStatus | "")
            }
          >
            <option value="">All statuses</option>
            <option value="provisioning">Provisioning</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </Select>
          <p className="shrink-0 text-sm text-muted-foreground" aria-live="polite">
            {isLoading && items.length === 0
              ? "Loading…"
              : `${filtered.length} app${filtered.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {isLoading && items.length === 0 ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : error && items.length === 0 ? (
        <ErrorState
          description={error}
          onRetry={() => void load(null, true)}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<AppWindow className="size-5" />}
          title={items.length === 0 ? "No apps yet" : "No matching apps"}
          description={
            items.length === 0
              ? "Create your first app to get a public URL."
              : "Try a different search or filter."
          }
          action={
            items.length === 0 ? (
              <Button asChild>
                <Link href="/apps/new">
                  <Plus />
                  New app
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-xl border md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Name</th>
                  <th className="px-4 py-2.5 font-semibold">URL</th>
                  <th className="px-4 py-2.5 font-semibold">Region</th>
                  <th className="px-4 py-2.5 font-semibold">Size</th>
                  <th className="px-4 py-2.5 font-semibold">Deployed</th>
                  <th className="w-12 px-2 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((app) => (
                  <tr key={app.id} className="border-b last:border-b-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <a
                        href={`/apps/${app.id}`}
                        className="flex items-center gap-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-foreground">
                            {app.name}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {app.slug}
                          </span>
                        </span>
                        <StatusBadge status={app.status} className="shrink-0" />
                      </a>
                    </td>
                    <td className="max-w-56 px-4 py-3">
                      <CopyField value={appUrl(app.slug)} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {regionName(app.region)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatGuestSize(app.runtime?.guest)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <RelativeTime value={app.lastOperationAt ?? app.updatedAt} />
                    </td>
                    <td className="px-2 py-3 text-right">
                      <RowActions app={app} onDelete={() => setDeleteTarget(app)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked rows */}
          <ul className="flex flex-col gap-2 md:hidden">
            {filtered.map((app) => (
              <li
                key={app.id}
                className="rounded-xl border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <a
                    href={`/apps/${app.id}`}
                    className="min-w-0 flex-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold text-foreground">
                        {app.name}
                      </p>
                      <StatusBadge status={app.status} className="shrink-0" />
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {app.slug}
                    </p>
                  </a>
                  <RowActions app={app} onDelete={() => setDeleteTarget(app)} />
                </div>
                <div className="mt-3 border-t pt-3">
                  <CopyField value={appUrl(app.slug)} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Region</dt>
                    <dd className="text-foreground">{regionName(app.region)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Size</dt>
                    <dd className="text-foreground">
                      {formatGuestSize(app.runtime?.guest)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Deployed</dt>
                    <dd className="text-foreground">
                      <RelativeTime value={app.lastOperationAt ?? app.updatedAt} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => void load(nextCursor, false)}
          >
            Load more
          </Button>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDeleteDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={`Delete ${deleteTarget.name}?`}
          description={
            <>
              This permanently deletes the app and its machine. The public URL
              will stop working immediately. This cannot be undone.
            </>
          }
          confirmText={deleteTarget.name}
          isPending={isDeleting}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
}

const queryClient = new QueryClient();

export function AppsPageProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppsPage />
    </QueryClientProvider>
  );
}