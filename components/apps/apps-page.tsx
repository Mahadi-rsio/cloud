"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { listApplications, type Application, type ApplicationStatus } from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "./status-badge";
import { formatDate, formatRegion } from "./format";
import { CreateApplicationDialog } from "./create-application-dialog";
import { DeleteApplicationDialog } from "./delete-application-dialog";

const LIST_PAGE_SIZE = 20;

export function AppsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Application[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);

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
        setItems([...items, ...page.items]);
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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Apps</CardTitle>
          <CardDescription>
            Create and manage applications running on Fly. Each app gets a free
            shared IP and a public URL.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load(null, true)}
              >
                <RefreshCw />
                Refresh
              </Button>
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <Plus />
                New app
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {isLoading && items.length === 0
                ? "Loading…"
                : `${items.length} app${items.length === 1 ? "" : "s"}`}
            </p>
            <Select
              className="w-44"
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
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {isLoading && items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading apps…
              </p>
            ) : error && items.length === 0 ? (
              <div className="py-8 text-center">
                <p
                  role="alert"
                  className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
                >
                  {error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void load(null, true)}
                >
                  Try again
                </Button>
              </div>
            ) : items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No apps yet. Create your first app.
              </p>
            ) : (
              items.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center justify-between gap-4 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-accent"
                >
                  <a href={`/apps/${app.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {app.name}
                      </p>
                      <StatusBadge status={app.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.slug} · {formatRegion(app.region)}
                    </p>
                  </a>
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${app.name}`}
                      onClick={() => setDeleteTarget(app)}
                    >
                      <Trash2 />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(app.updatedAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {nextCursor && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => void load(nextCursor, false)}
              >
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateApplicationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(application) => router.push(`/apps/${application.id}`)}
      />
      {deleteTarget && (
        <DeleteApplicationDialog
          application={deleteTarget}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onDeleted={() => void load(null, true)}
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