"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  RotateCw,
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
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={36} width={288} />
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={256} />
      </Stack>
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "flex-start" },
          justifyContent: { sm: "space-between" },
          gap: 2,
        }}
      >
        <Box sx={{ display: "flex", minWidth: 0, flexDirection: "column", gap: 0.5 }}>
          <Button
            component={Link}
            href="/apps"
            variant="text"
            size="small"
            startIcon={<ArrowLeft size={14} />}
            sx={{ alignSelf: "flex-start", px: 0, color: "var(--muted-foreground)" }}
          >
            Back to Apps
          </Button>
          <Typography
            variant="h5"
            component="h1"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            <GitBranch size={22} color="var(--muted-foreground)" />
            <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
              {deployment.repoOwner}/{deployment.repoName}
            </Box>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: "42rem" }}>
            <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
              {deployment.branch}
            </Box>
            {deployment.commitSha && (
              <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
                {" "}
                · #{deployment.commitSha.slice(0, 7)}
              </Box>
            )}
            <span> · build {deployment.buildNumber}</span>
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", flexShrink: 0 }}>
          <StatusBadge status={deployment.status} size="medium" />
          {deployment.publicUrl && (
            <Button
              type="button"
              variant="outlined"
              size="small"
              startIcon={<ExternalLink size={14} />}
              onClick={() => window.open(deployment.publicUrl ?? "", "_blank", "noopener")}
            >
              Open site
            </Button>
          )}
          {isTerminalDeploymentStatus(deployment.status) && (
            <Button
              type="button"
              variant="contained"
              size="small"
              disabled={isRetrying}
              onClick={() => void handleRetry()}
              startIcon={
                isRetrying ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <RotateCw size={14} />
                )
              }
            >
              {isRetrying ? "Retrying…" : "Retry"}
            </Button>
          )}
        </Stack>
      </Box>

      {deployment.status === "failed" && deployment.errorMessage && (
        <Alert severity="error">{deployment.errorMessage}</Alert>
      )}
      {retryError && <Alert severity="error">{retryError}</Alert>}

      <Paper variant="outlined" sx={{ borderRadius: "12px", px: 2.5, py: 0.5 }}>
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
      </Paper>

      <DeploymentLogsViewer
        deploymentId={deployment.id}
        initialStatus={deployment.status}
        buildNumber={deployment.buildNumber}
      />
    </Box>
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
