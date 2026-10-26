"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Settings2,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  deleteApplication,
  getApplication,
  updateApplication,
  type Application,
  type Machine,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { appUrl } from "@/lib/site";
import type { RuntimeInput } from "@/lib/validators/application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyField } from "@/components/shared/copy-field";
import { DataList } from "@/components/shared/data-list";
import { ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { ComingSoonDialog } from "@/components/shared/coming-soon";
import {
  formatDate,
  formatGuestSize,
  regionName,
  shortImageName,
} from "@/components/apps/format";
import { EditApplicationDialog } from "./edit-application-dialog";
import { MachineLogsViewer } from "./machine-logs-viewer";

type Tab = "overview" | "logs" | "env" | "metrics" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs" },
  { id: "env", label: "Env vars" },
  { id: "metrics", label: "Metrics" },
  { id: "settings", label: "Settings" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-foreground">{children}</h2>
  );
}

function OverviewTab({
  application,
  machines,
  onViewLogs,
}: {
  application: Application;
  machines: Machine[];
  onViewLogs: () => void;
}) {
  const machine = machines[0];
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <SectionTitle>Runtime</SectionTitle>
        <DataList
          items={[
            {
              label: "Image",
              value: (
                <span
                  className="block truncate font-mono text-sm"
                  title={application.runtime?.image}
                >
                  {shortImageName(application.runtime?.image)}
                </span>
              ),
            },
            {
              label: "Size",
              value: formatGuestSize(application.runtime?.guest),
            },
            { label: "Region", value: regionName(application.region) },
            {
              label: "Port",
              value: application.runtime?.internalPort
                ? String(application.runtime.internalPort)
                : "—",
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>Deployment</SectionTitle>
        <DataList
          items={[
            { label: "Created", value: formatDate(application.createdAt) },
            { label: "Last updated", value: formatDate(application.updatedAt) },
            {
              label: "Last operation",
              value: formatDate(application.lastOperationAt),
            },
          ]}
        />
      </section>

      {machine && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <SectionTitle>Machine</SectionTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onViewLogs}
              className="gap-1.5 text-xs"
            >
              <Terminal className="size-3.5" />
              View machine logs
            </Button>
          </div>
          <DataList
            items={[
              {
                label: "Machine ID",
                value: machine.flyMachineId ? (
                  <CopyField value={machine.flyMachineId} />
                ) : (
                  "—"
                ),
              },
              {
                label: "Status",
                value: <StatusBadge status={machine.status} />,
              },
              {
                label: "Instance",
                value: `Instance ${machine.instanceNumber + 1}`,
              },
              {
                label: "IPv4",
                value: machine.sharedIpv4 ? (
                  <CopyField value={machine.sharedIpv4} />
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </section>
      )}
    </div>
  );
}


function EnvVarsTab({
  application,
  onUpdated,
}: {
  application: Application;
  onUpdated: (application: Application) => void;
}) {
  const initial = application.runtime?.env ?? {};
  const [entries, setEntries] = useState<[string, string][]>(() =>
    Object.entries(initial)
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: Record<string, string>) => {
    setIsSaving(true);
    setError(null);
    try {
      const { application: updated } = await updateApplication(
        application.id,
        {
          runtime: {
            ...(application.runtime ?? {}),
            env: next,
          } as RuntimeInput,
        }
      );
      onUpdated(updated);
    } catch (saveError) {
      setError(extractErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    if (entries.some(([existing]) => existing === key)) {
      setError(`Variable ${key} already exists.`);
      return;
    }
    const next = Object.fromEntries([...entries, [key, newValue]]);
    setEntries([...entries, [key, newValue]]);
    setNewKey("");
    setNewValue("");
    void save(next);
  };

  const remove = (key: string) => {
    const next = Object.fromEntries(entries.filter(([existing]) => existing !== key));
    setEntries(entries.filter(([existing]) => existing !== key));
    setRevealed((current) => {
      const copy = new Set(current);
      copy.delete(key);
      return copy;
    });
    void save(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-key">Key</Label>
            <Input
              id="env-key"
              value={newKey}
              onChange={(event) => setNewKey(event.target.value)}
              placeholder="DATABASE_URL"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-value">Value</Label>
            <Input
              id="env-value"
              value={newValue}
              onChange={(event) => setNewValue(event.target.value)}
              placeholder="postgres://…"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
        </div>
        <Button
          type="button"
          onClick={add}
          disabled={isSaving || !newKey.trim()}
        >
          <Plus />
          Add
        </Button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No environment variables yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border bg-card">
          {entries.map(([key, value]) => {
            const isRevealed = revealed.has(key);
            return (
              <li
                key={key}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                  {key}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
                  {isRevealed ? value : "••••••••"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={isRevealed ? `Hide ${key}` : `Reveal ${key}`}
                  onClick={() =>
                    setRevealed((current) => {
                      const copy = new Set(current);
                      if (isRevealed) copy.delete(key);
                      else copy.add(key);
                      return copy;
                    })
                  }
                >
                  {isRevealed ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground"
                  aria-label={`Delete ${key}`}
                  onClick={() => remove(key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MetricsTab() {
  return (
    <div className="rounded-xl border border-dashed px-6 py-14 text-center">
      <p className="text-base font-semibold text-foreground">
        Metrics are coming soon
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        CPU, memory and request graphs for this app will appear here.
      </p>
    </div>
  );
}

function SettingsTab({
  application,
  onUpdated,
  onDelete,
}: {
  application: Application;
  onUpdated: (application: Application) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(application.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const rename = async () => {
    setIsRenaming(true);
    setRenameError(null);
    try {
      const { application: updated } = await updateApplication(application.id, {
        name: name.trim(),
      });
      onUpdated(updated);
    } catch (renameError) {
      setRenameError(extractErrorMessage(renameError));
    } finally {
      setIsRenaming(false);
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteApplication(application.id);
      onDelete();
    } catch (deleteError) {
      setRenameError(extractErrorMessage(deleteError));
      setDeleteOpen(false);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <SectionTitle>General</SectionTitle>
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="app-name">App name</Label>
            <Input
              id="app-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              The name is used to build the public URL. The slug cannot be
              changed.
            </p>
          </div>
          {renameError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {renameError}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void rename()}
              disabled={isRenaming || !name.trim() || name.trim() === application.name}
            >
              {isRenaming ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionTitle>Danger zone</SectionTitle>
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-foreground">
              Delete this app
            </p>
            <p className="text-sm text-muted-foreground">
              Permanently deletes the app and its machine. The public URL will
              stop working immediately. This cannot be undone.
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Delete app
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${application.name}?`}
        description={
          <>
            This permanently deletes the app and its machine. The public URL
            will stop working immediately. This cannot be undone.
          </>
        }
        confirmText={application.name}
        isPending={isDeleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<{
    application: Application;
    machines: Machine[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);

  const load = async () => {
    try {
      setError(null);
      setIsLoading(true);
      setData(await getApplication(id));
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const match = TABS.find((t) => t.id === raw);
      setTab(match ? match.id : "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    window.location.hash = next;
  };

  const application = data?.application;
  const machines = data?.machines ?? [];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <a
        href="/apps"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Apps
      </a>

      {isLoading && !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error && !data ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : application ? (
        <>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2.5">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
                    {application.name}
                  </h1>
                  <StatusBadge status={application.status} className="shrink-0" />
                </div>
                <p className="truncate font-mono text-sm text-muted-foreground">
                  {application.slug}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setRedeployOpen(true)}>
                  <RotateCw className="size-4" />
                  Redeploy
                </Button>
                <Button type="button" asChild>
                  <a href={appUrl(application.slug)} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open
                  </a>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                      <Settings2 className="size-4" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRestartOpen(true)}>
                      <RefreshCw className="size-4" />
                      Restart
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  URL
                </span>
                <CopyField value={appUrl(application.slug)} className="flex-1" />
              </div>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={appUrl(application.slug)} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  Open
                </a>
              </Button>
              {machines[0]?.sharedIpv4 && (
                <div className="flex min-w-0 items-center gap-2 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    IP
                  </span>
                  <CopyField value={machines[0].sharedIpv4} className="flex-1" />
                </div>
              )}
            </div>
          </div>

          <Tabs value={tab} onValueChange={(value) => selectTab(value as Tab)}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview">
              <OverviewTab
                application={application}
                machines={machines}
                onViewLogs={() => selectTab("logs")}
              />
            </TabsContent>
            <TabsContent value="logs">
              <MachineLogsViewer
                application={application}
                machines={machines}
              />
            </TabsContent>
            <TabsContent value="env">
              <EnvVarsTab
                application={application}
                onUpdated={(updated) =>
                  setData((current) =>
                    current ? { ...current, application: updated } : current
                  )
                }
              />
            </TabsContent>
            <TabsContent value="metrics">
              <MetricsTab />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsTab
                application={application}
                onUpdated={(updated) =>
                  setData((current) =>
                    current ? { ...current, application: updated } : current
                  )
                }
                onDelete={() => {
                  router.push("/apps");
                  router.refresh();
                }}
              />
            </TabsContent>
          </Tabs>

          <EditApplicationDialog
            application={application}
            open={editOpen}
            onOpenChange={setEditOpen}
            onUpdated={() => void load()}
          />
          <ComingSoonDialog
            open={redeployOpen}
            onOpenChange={setRedeployOpen}
            title="Redeploy"
            description="Redeploying is coming soon. You will be able to rebuild and redeploy this app from its image."
          />
          <ComingSoonDialog
            open={restartOpen}
            onOpenChange={setRestartOpen}
            title="Restart"
            description="Restarting is coming soon. You will be able to restart this app's machine from here."
          />
        </>
      ) : null}
    </div>
  );
}

const queryClient = new QueryClient();

export function ApplicationDetailProvider({ id }: { id: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationDetail id={id} />
    </QueryClientProvider>
  );
}