"use client";

import * as React from "react";
import {
  ShieldCheck,
  Plus,
  Search,
  RefreshCw,
  Code2,
  Trash2,
  MoreHorizontal,
  KeyRound,
  Database,
  Mail,
  Copy,
  Check,
  Globe,
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
import { CreateAuthProjectDialog } from "./create-auth-project-dialog";
import { ConnectAuthProjectDialog } from "./connect-auth-project-dialog";
import {
  authRuntimeUrl,
  deleteAuthProject,
  listAuthProjects,
  type AuthProjectItem,
} from "@/lib/auth-projects/client";
import { extractErrorMessage } from "@/lib/errors";

export function AuthProjectsPage() {
  const [projects, setProjects] = React.useState<AuthProjectItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");

  const [createOpen, setCreateOpen] = React.useState(false);
  const [connectProject, setConnectProject] = React.useState<AuthProjectItem | null>(null);
  const [deleteProject, setDeleteProject] = React.useState<AuthProjectItem | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [copiedKeyId, setCopiedKeyId] = React.useState<string | null>(null);
  const [runtimeUrl, setRuntimeUrl] = React.useState("/api/auth-runtime");

  React.useEffect(() => {
    setRuntimeUrl(authRuntimeUrl());
  }, []);

  const loadProjects = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setProjects(await listAuthProjects());
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleCopyKey = async (project: AuthProjectItem) => {
    try {
      await navigator.clipboard.writeText(project.publishableKey);
      setCopiedKeyId(project.id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = project.publishableKey;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedKeyId(project.id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteProject) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await deleteAuthProject(deleteProject.id);
      setProjects((prev) => prev.filter((project) => project.id !== deleteProject.id));
      setDeleteProject(null);
    } catch (err) {
      setDeleteError(extractErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredProjects = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(query) ||
        project.namespace.toLowerCase().includes(query) ||
        project.publishableKey.toLowerCase().includes(query),
    );
  }, [projects, searchQuery]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Auth"
        description="Managed Better Auth backends with dedicated SQLite namespaces, email/password auth, and a shared runtime proxy."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadProjects()}
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
              Create Auth Project
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Active Projects</span>
            <span className="text-lg font-semibold">{projects.length}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <Mail className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Auth Method</span>
            <span className="text-lg font-semibold">Email + Password</span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-2xs">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
            <Globe className="size-5" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-muted-foreground">Runtime Endpoint</span>
            <span className="truncate font-mono text-xs text-foreground">{runtimeUrl}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search auth projects..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-xl border border-muted bg-muted/20"
            />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Failed to load auth projects"
          description={error}
          onRetry={() => void loadProjects()}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-6" />}
          title="No auth projects yet"
          description="Create your first managed Better Auth backend. It gets its own SQLite namespace and a publishable key."
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              Create Auth Project
            </Button>
          }
        />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={<Search className="size-6" />}
          title="No matching auth projects"
          description={`No project found matching "${searchQuery}".`}
          action={
            <Button variant="outline" onClick={() => setSearchQuery("")}>
              Clear Search
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredProjects.map((project) => {
            const hasCopiedKey = copiedKeyId === project.id;

            return (
              <div
                key={project.id}
                className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-2xs transition-all hover:border-foreground/20"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <ShieldCheck className="size-4" />
                      </div>
                      <span className="truncate text-base font-semibold text-foreground">
                        {project.name}
                      </span>
                      <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                        {project.namespace}
                      </span>
                      <StatusBadge status={project.status} />
                    </div>

                    <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="shrink-0 font-medium text-foreground">Key:</span>
                        <CopyField
                          value={project.publishableKey}
                          className="max-w-xs rounded bg-muted/40 px-2 py-0.5 sm:max-w-md"
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span>Created</span>
                        <RelativeTime value={project.createdAt} className="font-medium" />
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t pt-2 sm:w-auto sm:flex-nowrap sm:border-t-0 sm:pt-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConnectProject(project)}
                      className="flex-1 gap-1.5 sm:flex-initial"
                    >
                      <Code2 className="size-3.5" />
                      Connect
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleCopyKey(project)}
                      className="shrink-0 gap-1 text-xs"
                      title="Copy publishable key"
                    >
                      {hasCopiedKey ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          Copied
                        </>
                      ) : (
                        <>
                          <KeyRound className="size-3.5" />
                          Key
                        </>
                      )}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" className="size-8 shrink-0">
                          <MoreHorizontal className="size-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onClick={() => setConnectProject(project)}>
                          <Code2 className="mr-2 size-4 text-primary" />
                          Connection Guide
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void handleCopyKey(project)}>
                          <KeyRound className="mr-2 size-4" />
                          Copy Publishable Key
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void navigator.clipboard.writeText(runtimeUrl);
                          }}
                        >
                          <Copy className="mr-2 size-4" />
                          Copy Runtime URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            void navigator.clipboard.writeText(project.httpUrl);
                          }}
                        >
                          <Database className="mr-2 size-4" />
                          Copy Database URL
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteProject(project);
                          }}
                        >
                          <Trash2 className="mr-2 size-4" />
                          Delete Project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateAuthProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={(project) => {
          setProjects((prev) => [project, ...prev]);
        }}
        onOpenConnect={(project) => {
          setConnectProject(project);
        }}
      />

      <ConnectAuthProjectDialog
        project={connectProject}
        open={Boolean(connectProject)}
        onOpenChange={(open) => {
          if (!open) setConnectProject(null);
        }}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteProject)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteProject(null);
            setDeleteError(null);
          }
        }}
        title={`Delete "${deleteProject?.name}"?`}
        description={
          <div className="flex flex-col gap-2">
            <span>
              This permanently deletes the auth project, its users, sessions, and
              its dedicated SQLite namespace. This action cannot be undone.
            </span>
            {deleteError && (
              <span className="rounded bg-destructive/10 p-2 text-xs text-destructive">
                {deleteError}
              </span>
            )}
          </div>
        }
        confirmText={deleteProject?.name}
        confirmLabel={isDeleting ? "Deleting..." : "Delete Project"}
        isPending={isDeleting}
        onConfirm={() => void handleDeleteConfirm()}
      />
    </div>
  );
}
