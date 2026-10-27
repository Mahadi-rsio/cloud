"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import {
  createDeployment,
  isTerminalDeploymentStatus,
  listDeployments,
  validateDeployment,
  type Deployment,
  type ValidatedRepository,
} from "@/lib/deployments";
import { extractErrorMessage } from "@/lib/errors";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export function GitHubDeployPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<ValidatedRepository | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [items, setItems] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const hasActive = () => items.some((d) => !isTerminalDeploymentStatus(d.status));

  const loadDeployments = async (refreshing = false) => {
    try {
      if (refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setListError(null);
      const res = await listDeployments({ limit: 12 });
      setItems(res.items);
    } catch (err) {
      setListError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDeployments();
  }, []);

  useEffect(() => {
    if (!hasActive()) return;
    const id = setInterval(() => void loadDeployments(true), 5000);
    return () => clearInterval(id);
  }, [items]);

  const handleCheck = async () => {
    if (!url.trim()) return;
    setCheckError(null);
    setIsChecking(true);
    try {
      const result = await validateDeployment({ url: url.trim() });
      if (result.valid) {
        setPreview(result.repository);
      } else {
        setPreview(null);
        setCheckError(result.message);
      }
    } catch (err) {
      setCheckError(extractErrorMessage(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setFieldError("Enter a public GitHub repository URL.");
      return;
    }
    try {
      setIsSubmitting(true);
      const deployment = await createDeployment({ url: trimmed });
      setPreview(null);
      router.push(`/deployments/${deployment.id}`);
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="GitHub"
        description="Deploy a public GitHub repository. Railpack detects your stack automatically, or you can pin a Dockerfile."
      />

      {/* Deploy form */}
      <section className="rounded-xl border bg-card p-5">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="repo-url">Repository URL</Label>
            <Input
              id="repo-url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setPreview(null);
                setCheckError(null);
                setFieldError(null);
              }}
              onBlur={() => void handleCheck()}
              placeholder="https://github.com/username/repository"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {fieldError ? (
              <p className="text-xs text-destructive">{fieldError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Must be a public repository on github.com. Branches and commits are resolved automatically.
              </p>
            )}
            {checkError && (
              <p className="text-xs text-destructive">{checkError}</p>
            )}
            {preview && (
              <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs text-foreground">
                <GitBranch className="size-3.5 text-foreground" />
                <span className="font-semibold font-mono">
                  {preview.owner}/{preview.name}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                  public
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {preview.defaultBranch}
                </span>
                {preview.fork && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    fork
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              disabled={isSubmitting || !url.trim() || hasActive()}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deploying…
                </>
              ) : (
                <>
                  <GitBranch className="size-4" />
                  Deploy
                </>
              )}
            </Button>
            {isChecking && (
              <span className="text-xs text-muted-foreground">Checking repository…</span>
            )}
            {hasActive() && (
              <span className="text-xs text-muted-foreground">
                A build is already running — new deployments are queued.
              </span>
            )}
          </div>

          {submitError && (
            <p className="rounded-lg bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
              {submitError}
            </p>
          )}
        </form>
      </section>

      {/* Recent deployments */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent deployments</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRefreshing}
            onClick={() => void loadDeployments(true)}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-3/4" />
          </div>
        ) : listError ? (
          <ErrorState
            title="Couldn't load deployments"
            description={listError}
            onRetry={() => void loadDeployments(true)}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<GitBranch className="size-5" />}
            title="No deployments yet"
            description="Paste a public GitHub repository URL above to create your first deployment."
          />
        ) : (
          <div className="divide-y divide-border rounded-xl border bg-card">
            {items.map((deployment) => (
              <DeploymentRow key={deployment.id} deployment={deployment} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 font-mono text-sm font-medium text-foreground">
          {deployment.repoOwner}/{deployment.repoName}
          {deployment.status === "active" && deployment.publicUrl && (
            <a
              href={deployment.publicUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Open deployed site"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{deployment.branch}</span>
          {deployment.commitSha && (
            <span className="font-mono text-[11px]">#{deployment.commitSha.slice(0, 7)}</span>
          )}
          <span className="text-muted-foreground">&middot; build {deployment.buildNumber}</span>
          <RelativeTime value={deployment.createdAt} />
        </span>
      </div>
      <StatusBadge status={deployment.status} className="shrink-0 text-sm" />
    </div>
  );
}