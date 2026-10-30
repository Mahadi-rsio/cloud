"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  Loader2,
  RefreshCw,
  RotateCw,
  Terminal,
} from "lucide-react";
import {
  getDeployment,
  isTerminalDeploymentStatus,
  retryDeployment,
  type Deployment,
} from "@/lib/deployments";
import { extractErrorMessage } from "@/lib/errors";
import { CopyField } from "@/components/shared/copy-field";
import { DataList } from "@/components/shared/data-list";
import { ErrorState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentLogsViewer } from "./deployment-logs-viewer";

const ACTIVE_STATUSES: Deployment["status"][] = [
  "queued",
  "preparing",
  "building",
  "pushing",
  "deploying",
];

export function DeploymentDetailPage({
  deploymentId,
}: {
  deploymentId: string;
}) {
  const router = useRouter();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const load = async () => {
    try {
      setDeployment(await getDeployment(deploymentId));
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  useEffect(() => {
    void load();
  }, [deploymentId]);

  const active = deployment ? ACTIVE_STATUSES.includes(deployment.status) : false;
  useEffect(() => {
    if (!deployment || !active) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [deployment, active]);

  if (error && !deployment) {
    return (
      <ErrorState
        title="Deployment not found"
        description={error}
        onRetry={() => void load()}
      />
    );
  }

  if (!deployment) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const handleRetry = async () => {
    setIsRetrying(true);
    setRetryError(null);
    try {
      const updated = await retryDeployment(deployment.id);
      setDeployment(updated);
    } catch (err) {
      setRetryError(extractErrorMessage(err));
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <a
            href="/apps"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to Apps
          </a>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <GitBranch className="size-6 text-muted-foreground" />
            <span className="font-mono">
              {deployment.repoOwner}/{deployment.repoName}
            </span>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <span className="font-mono">{deployment.branch}</span>
            {deployment.commitSha && (
              <span className="font-mono"> &middot; #{deployment.commitSha.slice(0, 7)}</span>
            )}
            <span> &middot; build {deployment.buildNumber}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusBadge status={deployment.status} className="text-base" />
          {deployment.publicUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => window.open(deployment.publicUrl ?? "", "_blank", "noopener")}
              className="gap-1.5 text-xs"
            >
              <ExternalLink className="size-3.5" />
              Open site
            </Button>
          )}
          {isTerminalDeploymentStatus(deployment.status) && (
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isRetrying}
              onClick={() => void handleRetry()}
              className="gap-1.5 text-xs"
            >
              {isRetrying ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Retrying…
                </>
              ) : (
                <>
                  <RotateCw className="size-3.5" />
                  Retry
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {deployment.status === "failed" && deployment.errorMessage && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
          {deployment.errorMessage}
        </div>
      )}
      {retryError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
          {retryError}
        </div>
      )}

      <section className="rounded-xl border bg-card">
        <DataList
          items={[
            {
              label: "Repository",
              value: <CopyField value={deployment.repoUrl} />,
            },
            { label: "Status", value: <StatusBadge status={deployment.status} /> },
            {
              label: "Started",
              value: deployment.startedAt ? formatExactTime(deployment.startedAt) : "—",
            },
            {
              label: "Finished",
              value: deployment.finishedAt ? formatExactTime(deployment.finishedAt) : "—",
            },
            {
              label: "Duration",
              value: formatDuration(deployment.startedAt, deployment.finishedAt),
            },
            {
              label: "Image",
              value: deployment.imageRef ? (
                <CopyField value={deployment.imageRef} display={shortImageName(deployment.imageRef)} />
              ) : (
                "—"
              ),
            },
            {
              label: "Deployment URL",
              value: deployment.publicUrl ? (
                <CopyField value={deployment.publicUrl} />
              ) : (
                "—"
              ),
            },
            {
              label: "Created",
              value: formatExactTime(deployment.createdAt),
            },
          ]}
        />
      </section>

      <DeploymentLogsViewer
        deploymentId={deployment.id}
        initialStatus={deployment.status}
        buildNumber={deployment.buildNumber}
      />
    </div>
  );
}

function formatExactTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatDuration(
  startedAt: string | null,
  finishedAt: string | null,
): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt
    ? new Date(finishedAt).getTime()
    : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function shortImageName(ref: string): string {
  const withoutScheme = ref.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const lastSegment = withoutScheme.split("/").pop() ?? withoutScheme;
  return lastSegment.length > 40
    ? `${lastSegment.slice(0, 40)}…`
    : lastSegment;
}