"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Rocket,
  Search,
  Unplug,
} from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { createApplicationSchema } from "@/lib/validators/application";
import { createApplication, FLY_REGIONS } from "@/lib/applications";
import {
  createDeployment,
  validateDeployment,
  discoverRepository,
  type ValidatedRepository,
  type DiscoveredRepositoryResult,
} from "@/lib/deployments";
import { parseDockerInput, type ParsedDockerImage } from "@/lib/docker";
import { extractErrorMessage } from "@/lib/errors";
import { STARTER_TEMPLATES, type StarterTemplate } from "./machine-presets";
import {
  getGitHubConnection,
  disconnectGitHub,
  type GitHubRepoItem,
} from "@/lib/github-client";
import { ConnectGitHubDialog } from "./connect-github-dialog";
import { DeploymentLogsViewer } from "@/components/deployments/deployment-logs-viewer";
import { CopyField } from "@/components/shared/copy-field";

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg role="img" aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

type Step = "configure" | "analyze" | "deploying";

const RAM_OPTIONS = [
  { value: 256, label: "256 MB", delta: 0, deltaLabel: null },
  { value: 512, label: "512 MB", delta: 2.5, deltaLabel: "+$2.50/mo" },
  { value: 1024, label: "1 GB", delta: 5.0, deltaLabel: "+$5/mo" },
  { value: 2048, label: "2 GB", delta: 11.0, deltaLabel: "+$11/mo" },
  { value: 4096, label: "4 GB", delta: 22.0, deltaLabel: "+$22/mo" },
  { value: 8192, label: "8 GB", delta: 44.0, deltaLabel: "+$44/mo" },
] as const;

const CPU_OPTIONS = [
  { value: 1, label: "1 vCPU", delta: 0, deltaLabel: null },
  { value: 2, label: "2 vCPU", delta: 0, deltaLabel: null },
  { value: 4, label: "4 vCPU", delta: 5.0, deltaLabel: "+$5/mo" },
  { value: 8, label: "8 vCPU", delta: 15.0, deltaLabel: "+$15/mo" },
] as const;

const VOLUME_OPTIONS = [
  { value: 0, label: "None", delta: 0, deltaLabel: null },
  { value: 1, label: "1 GB", delta: 0.15, deltaLabel: "+$0.15/mo" },
  { value: 3, label: "3 GB", delta: 0.45, deltaLabel: "+$0.45/mo" },
  { value: 5, label: "5 GB", delta: 0.75, deltaLabel: "+$0.75/mo" },
  { value: 10, label: "10 GB", delta: 1.5, deltaLabel: "+$1.50/mo" },
] as const;

const PERFORMANCE_CPU_DELTA = 29.0;

function formatRamLabel(ramMb: number): string {
  return ramMb >= 1024 ? `${ramMb / 1024} GB` : `${ramMb} MB`;
}

function calculateMonthlyEstimate(
  machineType: "shared" | "performance",
  ramMb: number,
  cpus: number,
  volumeGb: number,
): number {
  const ramCost = RAM_OPTIONS.find((r) => r.value === ramMb)?.delta ?? 0;
  const cpuCost = CPU_OPTIONS.find((c) => c.value === cpus)?.delta ?? 0;
  const diskCost = VOLUME_OPTIONS.find((v) => v.value === volumeGb)?.delta ?? 0;
  const computeCost = machineType === "performance" ? PERFORMANCE_CPU_DELTA : 0;
  return computeCost + ramCost + cpuCost + diskCost;
}

function formatMonthlyCost(amount: number): string {
  if (amount <= 0) return "$0 / month";
  return `~$${amount.toFixed(2)} / month`;
}

function toAppSlugPreview(rawName: string): string {
  const cleaned = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "my-app";
}

function FieldLabel({
  htmlFor,
  label,
  required = false,
  optional = false,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 1,
        mb: 0.75,
      }}
    >
      <Typography
        component={htmlFor ? "label" : "span"}
        htmlFor={htmlFor}
        sx={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--cd-ink)",
          lineHeight: 1.35,
        }}
      >
        {label}
        {required && (
          <Box component="span" aria-hidden="true" sx={{ color: "var(--cd-accent)", ml: 0.5 }}>
            *
          </Box>
        )}
      </Typography>
      {optional && (
        <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", fontWeight: 400 }}>
          Optional
        </Typography>
      )}
    </Box>
  );
}

const inputSx = {
  "& .MuiOutlinedInput-root": {
    minHeight: 44,
    borderRadius: "var(--cd-radius-control)",
    bgcolor: "var(--cd-surface)",
    color: "var(--cd-ink)",
    fontSize: 14,
    "& fieldset": {
      borderColor: "var(--cd-border)",
    },
    "&:hover fieldset": {
      borderColor: "var(--cd-muted)",
    },
    "&.Mui-focused fieldset": {
      borderColor: "var(--cd-accent)",
      borderWidth: "2px",
    },
  },
  "& .MuiInputBase-input::placeholder": {
    color: "var(--cd-muted)",
    opacity: 1,
    fontFamily: "var(--font-sans)",
  },
} as const;

const sectionDividerSx = {
  py: 3,
  borderBottom: "1px solid var(--cd-border)",
} as const;

function CreateApplicationContent() {
  const router = useRouter();

  // Wizard flow step
  const [step, setStep] = useState<Step>("configure");

  // Step 1: Core Configuration
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"github" | "docker">("github");

  // GitHub integration & source
  const [ghConnected, setGhConnected] = useState(false);
  const [ghUsername, setGhUsername] = useState<string | null>(null);
  const [ghRepos, setGhRepos] = useState<GitHubRepoItem[]>([]);
  const [isLoadingGh, setIsLoadingGh] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [showManualUrl, setShowManualUrl] = useState(false);

  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [isValidatingRepo, setIsValidatingRepo] = useState(false);
  const [repoPreview, setRepoPreview] = useState<ValidatedRepository | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  // Docker Source
  const [dockerInputRaw, setDockerInputRaw] = useState("");
  const [dockerParsed, setDockerParsed] = useState<ParsedDockerImage | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [internalPort, setInternalPort] = useState("");

  // Machine Hardware Sizing
  // Initial free tier defaults: shared, 256MB RAM, 2 CPUs, volume 0
  const [machineType, setMachineType] = useState<"shared" | "performance">("shared");
  const [ramMb, setRamMb] = useState<number>(256);
  const [cpus, setCpus] = useState<number>(2);
  const [volumeGb, setVolumeGb] = useState<number>(0);
  const [region, setRegion] = useState("sin");

  // Step 2: Discovery & Analysis
  const [isAnalyzingRepo, setIsAnalyzingRepo] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveredRepositoryResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [customRootDirectory, setCustomRootDirectory] = useState<string>(".");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySha, setDiscoverySha] = useState<string | null>(null);

  // Step 3: Deployment & Live Logs
  const [activeDeploymentId, setActiveDeploymentId] = useState<string | null>(null);
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const [activePublicUrl, setActivePublicUrl] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Load GitHub connection on mount
  useEffect(() => {
    let cancelled = false;
    const fetchGh = async () => {
      setIsLoadingGh(true);
      try {
        const res = await getGitHubConnection();
        if (cancelled) return;
        const repos = Array.isArray(res?.repos) ? res.repos : [];
        setGhConnected(Boolean(res?.connected));
        setGhUsername(res?.username ?? null);
        setGhRepos(repos);
        if (res?.connected && repos.length > 0) {
          setShowManualUrl(false);
        } else {
          setShowManualUrl(true);
        }
      } catch {
        if (!cancelled) setShowManualUrl(true);
      } finally {
        if (!cancelled) setIsLoadingGh(false);
      }
    };
    void fetchGh();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDisconnectGitHub = async () => {
    try {
      await disconnectGitHub();
      setGhConnected(false);
      setGhUsername(null);
      setGhRepos([]);
      setShowManualUrl(true);
    } catch (err) {
      console.warn("Failed to disconnect GitHub:", err);
    }
  };

  const handleGitHubConnected = (result: { username: string; repos: GitHubRepoItem[] }) => {
    setGhConnected(true);
    setGhUsername(result.username);
    setGhRepos(result.repos);
    if (result.repos.length > 0) {
      setShowManualUrl(false);
    }
  };

  const handleSelectGhRepo = (repo: GitHubRepoItem) => {
    setRepoUrl(repo.url);
    setRepoBranch(repo.defaultBranch);
    setRepoPreview({
      owner: repo.fullName.split("/")[0] || "",
      name: repo.name,
      url: repo.url,
      defaultBranch: repo.defaultBranch,
      fork: false,
      pushedAt: repo.updatedAt,
    });
    setRepoError(null);
    if (!name.trim()) {
      setName(repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
  };

  const handleValidateGitHub = async (urlToCheck?: string) => {
    const targetUrl = (urlToCheck ?? repoUrl).trim();
    if (!targetUrl) {
      setRepoPreview(null);
      setRepoError(null);
      return;
    }

    setIsValidatingRepo(true);
    setRepoError(null);
    try {
      const res = await validateDeployment({ url: targetUrl });
      if (res.valid) {
        setRepoPreview(res.repository);
        if (!name.trim()) {
          setName(res.repository.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
        }
        if (!repoBranch) {
          setRepoBranch(res.repository.defaultBranch);
        }
      } else {
        setRepoPreview(null);
        setRepoError(res.message);
      }
    } catch (err) {
      setRepoPreview(null);
      setRepoError(extractErrorMessage(err));
    } finally {
      setIsValidatingRepo(false);
    }
  };

  const handleDockerInputChange = (val: string) => {
    setDockerInputRaw(val);
    setSelectedTemplate(null);
    if (!val.trim()) {
      setDockerParsed(null);
      return;
    }
    const parsed = parseDockerInput(val);
    setDockerParsed(parsed);
    if (!name.trim() && parsed?.repository) {
      const defaultName = parsed.repository.split("/").pop() || parsed.repository;
      setName(defaultName.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
  };

  const handleApplyTemplate = (tpl: StarterTemplate) => {
    setSelectedTemplate(tpl.name);
    setDockerInputRaw(tpl.image);
    setDockerParsed(parseDockerInput(tpl.image));
    setInternalPort(String(tpl.port));
    if (!name.trim()) {
      setName(tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
  };

  // Run automated repository analysis
  const runAutoAnalysis = async (urlToScan: string, branchToScan: string) => {
    setIsAnalyzingRepo(true);
    setDiscoveryError(null);
    try {
      const res = await discoverRepository({
        url: urlToScan,
        ...(branchToScan ? { branch: branchToScan } : {}),
      });
      setDiscoveryResult(res.discovery);
      setDiscoverySha(res.commitSha);

      if (res.discovery.candidates && res.discovery.candidates.length > 0) {
        const recommendedRoot = res.discovery.recommendedRootDirectory;
        const matching =
          res.discovery.candidates.find((c) => c.rootDirectory === recommendedRoot) ??
          res.discovery.candidates.find((c) => c.isDeployable) ??
          res.discovery.candidates[0];

        if (matching) {
          setSelectedCandidateId(matching.id);
          setCustomRootDirectory(matching.rootDirectory);
          if (!name.trim() && matching.name) {
            setName(matching.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
          }
        }
      } else {
        setCustomRootDirectory(".");
      }
    } catch (err) {
      setDiscoveryError(extractErrorMessage(err));
      setCustomRootDirectory(".");
    } finally {
      setIsAnalyzingRepo(false);
    }
  };

  // Step navigation: Go to Step 2 (Analyze & Deployable Path)
  const handleProceedToAnalysis = async () => {
    setDeployError(null);
    if (!name.trim()) {
      setDeployError("Enter an app name before continuing.");
      return;
    }

    if (sourceType === "github") {
      const trimmedUrl = repoUrl.trim();
      if (!trimmedUrl) {
        setDeployError("Add a GitHub repository URL or select a repository to continue.");
        return;
      }
      setStep("analyze");
      const branchToUse = repoBranch.trim() || repoPreview?.defaultBranch || "main";
      void runAutoAnalysis(trimmedUrl, branchToUse);
    } else {
      const cleanImg = dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw.trim();
      if (!cleanImg) {
        setDeployError("Enter a Docker image or pick a starter image to continue.");
        return;
      }
      setStep("analyze");
    }
  };

  // Deploy Mutation
  const deployMutation = useMutation({
    mutationFn: async () => {
      setDeployError(null);
      if (sourceType === "github") {
        const trimmedUrl = repoUrl.trim();
        const selectedCandidate = discoveryResult?.candidates.find(
          (c) => c.id === selectedCandidateId,
        );
        const finalRoot = customRootDirectory.trim() || selectedCandidate?.rootDirectory || ".";

        const deployment = await createDeployment({
          url: trimmedUrl,
          name: name.trim(),
          region,
          machine: {
            cpuKind: machineType,
            cpus,
            memoryMb: ramMb,
          },
          ...(repoBranch.trim() ? { branch: repoBranch.trim() } : {}),
          ...(finalRoot ? { rootDirectory: finalRoot } : {}),
          ...(discoverySha ? { commitSha: discoverySha } : {}),
          ...(selectedCandidate?.framework ? { framework: selectedCandidate.framework } : {}),
          ...(selectedCandidate?.language ? { language: selectedCandidate.language } : {}),
          ...(selectedCandidate?.runtime ? { runtime: selectedCandidate.runtime } : {}),
          ...(selectedCandidate?.packageManager
            ? { packageManager: selectedCandidate.packageManager }
            : {}),
        });

        return { type: "github" as const, deploymentId: deployment.id };
      }

      const cleanImg = dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw.trim();
      const finalImage = cleanImg || "docker.io/library/nginx:alpine";

      const runtimePayload = {
        image: finalImage,
        guest: {
          cpu_kind: machineType,
          cpus,
          memory_mb: ramMb,
        },
        ...(internalPort.trim() ? { internalPort: Number(internalPort) } : {}),
      };

      const input = createApplicationSchema.parse({
        name: name.trim(),
        region,
        runtime: runtimePayload,
      });

      const res = await createApplication(input);
      return {
        type: "docker" as const,
        appId: res.application.id,
        appSlug: res.application.slug,
      };
    },
    onSuccess: (result) => {
      if (result.type === "github") {
        setActiveDeploymentId(result.deploymentId);
        setStep("deploying");
      } else {
        setActiveAppId(result.appId);
        setActivePublicUrl(`https://${result.appSlug}.fly.dev`);
        setStep("deploying");
      }
    },
    onError: (err) => {
      setDeployError(extractErrorMessage(err));
    },
  });

  const isFreeTier =
    machineType === "shared" && ramMb === 256 && cpus === 2 && volumeGb === 0;
  const monthlyEstimate = calculateMonthlyEstimate(machineType, ramMb, cpus, volumeGb);
  const monthlyCostLabel = formatMonthlyCost(monthlyEstimate);

  const selectedRegionObj = FLY_REGIONS.find((r) => r.code === region);
  const selectedRegionName = selectedRegionObj?.name || region;
  const diskSummaryLabel = volumeGb > 0 ? `${volumeGb} GB disk` : "No disk";
  const specSummaryLine = `${formatRamLabel(ramMb)} · ${cpus} vCPU · ${diskSummaryLabel} · ${selectedRegionName}`;

  const appSlugPreview = toAppSlugPreview(name);
  const previewDomainUrl = `https://${appSlugPreview}.cloudisy.top`;

  const disabledReason = !name.trim()
    ? "Enter an app name to continue"
    : sourceType === "github" && !repoUrl.trim()
      ? "Add a repository URL to continue"
      : sourceType === "docker" && !dockerInputRaw.trim()
        ? "Add a Docker image to continue"
        : null;

  const isConfigureReady = disabledReason === null;
  const primaryConfigureCta =
    sourceType === "github" ? "Continue to repo analysis" : "Continue to review";

  const filteredRepos = ghRepos.filter((r) =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  const stepIndex = step === "configure" ? 0 : step === "analyze" ? 1 : 2;
  const stepsList: { id: Step; label: string }[] = [
    { id: "configure", label: "Configure" },
    { id: "analyze", label: "Review" },
    { id: "deploying", label: "Deploy" },
  ];

  return (
    <Box
      className="cloudisy-create-flow"
      sx={{
        minHeight: "100%",
        bgcolor: "var(--cd-canvas)",
        color: "var(--cd-ink)",
        overflowX: "hidden",
      }}
    >
      <Box
        sx={{
          mx: "auto",
          width: "100%",
          maxWidth: 1080,
          px: 2, // 16px mobile & desktop gutter
          pt: { xs: 2, sm: 3 },
          pb: { xs: 14, lg: 8 },
        }}
      >
        {/* Top Navigation & Header */}
        <Box sx={{ pb: 2.5, borderBottom: "1px solid var(--cd-border)" }}>
          <Button
            component={Link}
            href="/apps"
            variant="text"
            size="small"
            startIcon={<ArrowLeft style={{ width: 16, height: 16 }} />}
            sx={{
              ml: -1,
              minHeight: 44,
              px: 1,
              color: "var(--cd-muted)",
              fontSize: 14,
              "&:hover": { color: "var(--cd-ink)", bgcolor: "transparent" },
            }}
          >
            Back to Apps
          </Button>

          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: { xs: "stretch", md: "flex-end" },
              justifyContent: "space-between",
              gap: 2,
              mt: 0.5,
            }}
          >
            <Box sx={{ maxWidth: "65ch" }}>
              <Typography
                variant="h1"
                sx={{
                  fontSize: { xs: 20, sm: 28 },
                  fontWeight: 700,
                  lineHeight: 1.2,
                  letterSpacing: "-0.02em",
                  color: "var(--cd-ink)",
                }}
              >
                Create new application
              </Typography>
              <Typography
                sx={{
                  fontSize: 14,
                  color: "var(--cd-muted)",
                  mt: 0.75,
                  lineHeight: 1.5,
                }}
              >
                Connect a repo or container image, pick compute, and deploy to a public Cloudisy URL.
              </Typography>
            </Box>

            {/* Compact 3-step Progress Bar (never wraps) */}
            <Box
              component="nav"
              aria-label="Deployment progress"
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 1,
                minWidth: { md: 280 },
                flexShrink: 0,
              }}
            >
              {stepsList.map((item, idx) => {
                const isActive = idx === stepIndex;
                const isDone = idx < stepIndex;
                const canClickBack = item.id === "configure" && step === "analyze";
                return (
                  <Box
                    key={item.id}
                    component={canClickBack ? "button" : "div"}
                    type={canClickBack ? "button" : undefined}
                    onClick={canClickBack ? () => setStep("configure") : undefined}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.75,
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      p: 0,
                      cursor: canClickBack ? "pointer" : "default",
                      minHeight: 44,
                      justifyContent: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 12,
                        fontWeight: isActive ? 700 : 500,
                        color: isActive
                          ? "var(--cd-ink)"
                          : isDone
                            ? "var(--cd-accent)"
                            : "var(--cd-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {idx + 1}. {item.label}
                    </Typography>
                    <Box
                      sx={{
                        height: 3,
                        width: "100%",
                        borderRadius: 99,
                        bgcolor: isActive || isDone ? "var(--cd-accent)" : "var(--cd-border)",
                        transition: "background-color 150ms ease",
                      }}
                    />
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        {/* Global Error Banner */}
        {deployError && (
          <Stack
            direction="row"
            spacing={1.25}
            role="alert"
            sx={{
              alignItems: "center",
              mt: 2.5,
              borderRadius: "var(--cd-radius-control)",
              border: "1px solid var(--cd-danger)",
              bgcolor: "var(--cd-danger-tint)",
              p: 1.5,
              color: "var(--cd-danger)",
              fontSize: 14,
            }}
          >
            <AlertCircle style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>{deployError}</span>
          </Stack>
        )}

        {/* =========================================================================
            STEP 1: CONFIGURE
        ========================================================================= */}
        {step === "configure" && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 340px" },
              gap: { xs: 0, lg: 5 },
              alignItems: "start",
            }}
          >
            {/* Left Column: Flat Form Sections */}
            <Box sx={{ minWidth: 0 }}>
              {/* 1. App Name */}
              <Box sx={sectionDividerSx}>
                <FieldLabel htmlFor="app-name-input" label="App name" required />
                <TextField
                  id="app-name-input"
                  size="small"
                  fullWidth
                  autoComplete="off"
                  placeholder="my-api-service"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  sx={inputSx}
                />
                <Typography
                  sx={{
                    fontSize: 12,
                    color: "var(--cd-muted)",
                    mt: 1,
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 0.75,
                  }}
                >
                  <span>Live URL:</span>
                  <Box
                    component="code"
                    sx={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--cd-ink)",
                      wordBreak: "break-all",
                    }}
                  >
                    {previewDomainUrl}
                  </Box>
                </Typography>
              </Box>

              {/* 2. Source */}
              <Box sx={sectionDividerSx}>
                <FieldLabel label="Source" required />

                {/* Segmented Source Toggle */}
                <Box
                  role="tablist"
                  aria-label="Deployment source"
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 0.5,
                    p: 0.5,
                    borderRadius: "var(--cd-radius-control)",
                    bgcolor: "var(--cd-surface-alt)",
                    border: "1px solid var(--cd-border)",
                    mb: 2.5,
                  }}
                >
                  <Box
                    component="button"
                    type="button"
                    role="tab"
                    aria-selected={sourceType === "github"}
                    onClick={() => setSourceType("github")}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 1,
                      minHeight: 40,
                      px: 1.5,
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: sourceType === "github" ? 700 : 500,
                      fontSize: 14,
                      fontFamily: "var(--font-sans)",
                      bgcolor: sourceType === "github" ? "var(--cd-surface)" : "transparent",
                      color: sourceType === "github" ? "var(--cd-ink)" : "var(--cd-muted)",
                      transition: "background-color 150ms ease, color 150ms ease",
                    }}
                  >
                    <GitHubIcon size={16} />
                    <span>GitHub</span>
                  </Box>

                  <Box
                    component="button"
                    type="button"
                    role="tab"
                    aria-selected={sourceType === "docker"}
                    onClick={() => setSourceType("docker")}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 1,
                      minHeight: 40,
                      px: 1.5,
                      borderRadius: "4px",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: sourceType === "docker" ? 700 : 500,
                      fontSize: 14,
                      fontFamily: "var(--font-sans)",
                      bgcolor: sourceType === "docker" ? "var(--cd-surface)" : "transparent",
                      color: sourceType === "docker" ? "var(--cd-ink)" : "var(--cd-muted)",
                      transition: "background-color 150ms ease, color 150ms ease",
                    }}
                  >
                    <span>Docker image</span>
                  </Box>
                </Box>

                {/* GitHub Source Content */}
                {sourceType === "github" && (
                  <Stack spacing={2.5}>
                    {/* Public URL first when not connected or manual mode */}
                    {(showManualUrl || !ghConnected || ghRepos.length === 0) && (
                      <Box>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "baseline",
                            justifyContent: "space-between",
                            gap: 1,
                          }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <FieldLabel htmlFor="repo-url-input" label="Repository URL" required />
                          </Box>
                          {ghConnected && ghRepos.length > 0 && (
                            <Button
                              type="button"
                              variant="text"
                              size="small"
                              onClick={() => setShowManualUrl(false)}
                              sx={{
                                fontSize: 12,
                                minHeight: 32,
                                color: "var(--cd-accent)",
                                p: 0,
                              }}
                            >
                              Pick from my repos
                            </Button>
                          )}
                        </Box>

                        <TextField
                          id="repo-url-input"
                          type="url"
                          size="small"
                          fullWidth
                          placeholder="https://github.com/owner/repo"
                          value={repoUrl}
                          onChange={(e) => {
                            setRepoUrl(e.target.value);
                            setRepoPreview(null);
                            setRepoError(null);
                          }}
                          onBlur={() => void handleValidateGitHub()}
                          sx={inputSx}
                          slotProps={{
                            htmlInput: {
                              sx: {
                                fontFamily: repoUrl ? "var(--font-mono)" : "var(--font-sans)",
                                fontSize: 13.5,
                              },
                            },
                            input: {
                              endAdornment: (
                                <Button
                                  type="button"
                                  size="small"
                                  variant="text"
                                  onClick={() => void handleValidateGitHub()}
                                  disabled={isValidatingRepo || !repoUrl.trim()}
                                  sx={{
                                    minHeight: 36,
                                    minWidth: 64,
                                    px: 1.25,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: "var(--cd-accent)",
                                    "&.Mui-disabled": { color: "var(--cd-muted)" },
                                  }}
                                >
                                  {isValidatingRepo ? <CircularProgress size={14} /> : "Verify"}
                                </Button>
                              ),
                            },
                          }}
                        />
                        <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                          Paste any public GitHub URL. We inspect the repo in the next step.
                        </Typography>
                      </Box>
                    )}

                    {/* Connected GitHub Repo Picker */}
                    {ghConnected && ghRepos.length > 0 && !showManualUrl && (
                      <Stack spacing={1.5}>
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                          }}
                        >
                          <FieldLabel label="Select repository" required />
                          <Button
                            type="button"
                            variant="text"
                            size="small"
                            onClick={() => setShowManualUrl(true)}
                            sx={{ fontSize: 12, color: "var(--cd-accent)", p: 0 }}
                          >
                            Paste URL instead
                          </Button>
                        </Box>

                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Search your repositories"
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          sx={inputSx}
                          slotProps={{
                            input: {
                              startAdornment: (
                                <Search
                                  style={{
                                    width: 15,
                                    height: 15,
                                    marginRight: 8,
                                    color: "var(--cd-muted)",
                                    flexShrink: 0,
                                  }}
                                />
                              ),
                            },
                          }}
                        />

                        <Box
                          sx={{
                            maxHeight: 224,
                            overflowY: "auto",
                            borderRadius: "var(--cd-radius-container)",
                            border: "1px solid var(--cd-border)",
                            bgcolor: "var(--cd-surface)",
                          }}
                        >
                          {filteredRepos.length === 0 ? (
                            <Box sx={{ p: 2, textAlign: "center", color: "var(--cd-muted)", fontSize: 13 }}>
                              No repositories match "{repoSearch}".
                            </Box>
                          ) : (
                            filteredRepos.map((repo) => {
                              const isSelected = repoUrl === repo.url;
                              return (
                                <Box
                                  key={repo.id}
                                  component="button"
                                  type="button"
                                  onClick={() => handleSelectGhRepo(repo)}
                                  sx={{
                                    display: "flex",
                                    width: "100%",
                                    minHeight: 48,
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 1.5,
                                    px: 1.5,
                                    py: 1,
                                    border: "none",
                                    borderBottom: "1px solid var(--cd-border)",
                                    borderLeft: isSelected
                                      ? "3px solid var(--cd-accent)"
                                      : "3px solid transparent",
                                    bgcolor: isSelected ? "var(--cd-accent-tint)" : "transparent",
                                    textAlign: "left",
                                    cursor: "pointer",
                                    color: "var(--cd-ink)",
                                    fontFamily: "var(--font-sans)",
                                    "&:hover": { bgcolor: "var(--cd-surface-alt)" },
                                    "&:last-child": { borderBottom: "none" },
                                  }}
                                >
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography
                                      noWrap
                                      sx={{ fontSize: 14, fontWeight: isSelected ? 700 : 500 }}
                                    >
                                      {repo.fullName}
                                      {repo.isPrivate ? " (Private)" : ""}
                                    </Typography>
                                    {repo.description && (
                                      <Typography
                                        noWrap
                                        sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.25 }}
                                      >
                                        {repo.description}
                                      </Typography>
                                    )}
                                  </Box>

                                  <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexShrink: 0 }}>
                                    <Typography
                                      sx={{
                                        fontFamily: "var(--font-mono)",
                                        fontSize: 12,
                                        color: "var(--cd-muted)",
                                      }}
                                    >
                                      {repo.defaultBranch}
                                    </Typography>
                                    {isSelected && (
                                      <Check style={{ width: 16, height: 16, color: "var(--cd-accent)" }} />
                                    )}
                                  </Stack>
                                </Box>
                              );
                            })
                          )}
                        </Box>
                      </Stack>
                    )}

                    {/* Validation Error */}
                    {repoError && (
                      <Stack
                        direction="row"
                        spacing={1}
                        role="alert"
                        sx={{
                          alignItems: "center",
                          borderRadius: "var(--cd-radius-control)",
                          border: "1px solid var(--cd-danger)",
                          bgcolor: "var(--cd-danger-tint)",
                          p: 1.25,
                          fontSize: 13,
                          color: "var(--cd-danger)",
                        }}
                      >
                        <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                        <span>{repoError}</span>
                      </Stack>
                    )}

                    {/* Verified Repo Inline Confirmation */}
                    {repoPreview && (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 1,
                          px: 1.5,
                          py: 1,
                          borderRadius: "var(--cd-radius-control)",
                          border: "1px solid var(--cd-free)",
                          bgcolor: "var(--cd-surface)",
                        }}
                      >
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                          <GitBranch style={{ width: 15, height: 15, color: "var(--cd-free)", flexShrink: 0 }} />
                          <Typography
                            noWrap
                            sx={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}
                          >
                            {repoPreview.owner}/{repoPreview.name}
                          </Typography>
                        </Stack>
                        <Typography sx={{ fontSize: 12, color: "var(--cd-free)", fontWeight: 600 }}>
                          Verified ·{" "}
                          <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
                            {repoPreview.defaultBranch}
                          </Box>
                        </Typography>
                      </Box>
                    )}

                    {/* Compact Single-Row GitHub Connect Prompt */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1.5,
                        px: 1.5,
                        py: 1,
                        minHeight: 48,
                        borderRadius: "var(--cd-radius-container)",
                        border: "1px solid var(--cd-border)",
                        bgcolor: "var(--cd-surface)",
                      }}
                    >
                      {ghConnected ? (
                        <>
                          <Typography sx={{ fontSize: 13, color: "var(--cd-ink)", minWidth: 0 }} noWrap>
                            GitHub connected as{" "}
                            <Box component="span" sx={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                              @{ghUsername}
                            </Box>{" "}
                            ({ghRepos.length} repos)
                          </Typography>
                          <Button
                            type="button"
                            variant="text"
                            size="small"
                            onClick={() => void handleDisconnectGitHub()}
                            startIcon={<Unplug style={{ width: 14, height: 14 }} />}
                            sx={{
                              minHeight: 36,
                              flexShrink: 0,
                              fontSize: 12.5,
                              color: "var(--cd-muted)",
                            }}
                          >
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <>
                          <Typography sx={{ fontSize: 13, color: "var(--cd-muted)" }}>
                            {isLoadingGh
                              ? "Checking GitHub connection…"
                              : "Deploying a private repository?"}
                          </Typography>
                          <Button
                            type="button"
                            variant="outlined"
                            size="small"
                            disabled={isLoadingGh}
                            onClick={() => setIsConnectDialogOpen(true)}
                            startIcon={<GitHubIcon size={14} />}
                            sx={{
                              minHeight: 36,
                              flexShrink: 0,
                              fontSize: 13,
                              fontWeight: 600,
                              borderRadius: "var(--cd-radius-control)",
                              borderColor: "var(--cd-border)",
                              color: "var(--cd-ink)",
                              "&:hover": {
                                borderColor: "var(--cd-accent)",
                                bgcolor: "var(--cd-accent-tint)",
                              },
                            }}
                          >
                            Connect GitHub
                          </Button>
                        </>
                      )}
                    </Box>

                    {/* Optional Branch */}
                    <Box>
                      <FieldLabel htmlFor="repo-branch-input" label="Branch" optional />
                      <TextField
                        id="repo-branch-input"
                        size="small"
                        fullWidth
                        placeholder={repoPreview?.defaultBranch || "main"}
                        value={repoBranch}
                        onChange={(e) => setRepoBranch(e.target.value)}
                        sx={inputSx}
                        slotProps={{
                          htmlInput: {
                            sx: {
                              fontFamily: repoBranch ? "var(--font-mono)" : "var(--font-sans)",
                              fontSize: 13.5,
                            },
                          },
                        }}
                      />
                      <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                        Defaults to the repository&apos;s default branch if left blank.
                      </Typography>
                    </Box>
                  </Stack>
                )}

                {/* Docker Source Content */}
                {sourceType === "docker" && (
                  <Stack spacing={2.5}>
                    <Box>
                      <FieldLabel label="Starter images" optional />
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                          gap: 1,
                        }}
                      >
                        {STARTER_TEMPLATES.map((tpl) => {
                          const active = selectedTemplate === tpl.name;
                          return (
                            <Box
                              key={tpl.name}
                              component="button"
                              type="button"
                              onClick={() => handleApplyTemplate(tpl)}
                              sx={{
                                minHeight: 44,
                                px: 1.5,
                                borderRadius: "var(--cd-radius-control)",
                                border: active
                                  ? "2px solid var(--cd-accent)"
                                  : "1px solid var(--cd-border)",
                                bgcolor: active ? "var(--cd-accent-tint)" : "var(--cd-surface)",
                                color: "var(--cd-ink)",
                                fontWeight: active ? 700 : 500,
                                fontSize: 13.5,
                                fontFamily: "var(--font-sans)",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 0.75,
                              }}
                            >
                              {active && <Check style={{ width: 14, height: 14, color: "var(--cd-accent)" }} />}
                              <span>{tpl.name}</span>
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>

                    <Box>
                      <FieldLabel htmlFor="docker-image-input" label="Docker image" required />
                      <TextField
                        id="docker-image-input"
                        size="small"
                        fullWidth
                        placeholder="nginx:alpine or ghcr.io/owner/app:latest"
                        value={dockerInputRaw}
                        onChange={(e) => handleDockerInputChange(e.target.value)}
                        sx={inputSx}
                        slotProps={{
                          htmlInput: {
                            sx: {
                              fontFamily: dockerInputRaw ? "var(--font-mono)" : "var(--font-sans)",
                              fontSize: 13.5,
                            },
                          },
                        }}
                      />
                      <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                        Supports Docker Hub, GHCR, or a full docker pull command.
                      </Typography>
                    </Box>

                    {dockerParsed && (
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 1.5,
                          flexWrap: "wrap",
                          px: 1.5,
                          py: 1,
                          borderRadius: "var(--cd-radius-control)",
                          border: "1px solid var(--cd-border)",
                          bgcolor: "var(--cd-surface)",
                        }}
                      >
                        <Typography sx={{ fontSize: 13, color: "var(--cd-muted)" }}>
                          {dockerParsed.registryLabel}
                        </Typography>
                        <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
                          {dockerParsed.cleanedImage}
                        </Typography>
                      </Box>
                    )}

                    <Box>
                      <FieldLabel htmlFor="docker-port-input" label="Internal port" optional />
                      <TextField
                        id="docker-port-input"
                        type="number"
                        size="small"
                        fullWidth
                        placeholder="Auto-detected (80, 3000, 8080)"
                        value={internalPort}
                        onChange={(e) => setInternalPort(e.target.value)}
                        sx={inputSx}
                      />
                      <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                        Leave blank to auto-detect from the container EXPOSE directive.
                      </Typography>
                    </Box>
                  </Stack>
                )}
              </Box>

              {/* 3. Compute & Resources */}
              <Box sx={{ ...sectionDividerSx, borderBottom: { xs: "1px solid var(--cd-border)", lg: "none" } }}>
                <Stack spacing={3}>
                  {/* Compute */}
                  <Box>
                    <FieldLabel label="Compute" required />
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                        gap: 1.25,
                      }}
                    >
                      <Box
                        component="button"
                        type="button"
                        onClick={() => setMachineType("shared")}
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 0.5,
                          p: 1.75,
                          minHeight: 44,
                          borderRadius: "var(--cd-radius-control)",
                          border:
                            machineType === "shared"
                              ? "2px solid var(--cd-accent)"
                              : "1px solid var(--cd-border)",
                          bgcolor:
                            machineType === "shared" ? "var(--cd-accent-tint)" : "var(--cd-surface)",
                          cursor: "pointer",
                          textAlign: "left",
                          color: "var(--cd-ink)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          <Typography sx={{ fontSize: 14, fontWeight: machineType === "shared" ? 700 : 600 }}>
                            Shared CPU
                          </Typography>
                          {machineType === "shared" && (
                            <Check style={{ width: 16, height: 16, color: "var(--cd-accent)", flexShrink: 0 }} />
                          )}
                        </Box>
                        <Typography sx={{ fontSize: 12.5, color: "var(--cd-muted)", lineHeight: 1.45 }}>
                          Shared CPU. Good for web apps and APIs. Can slow down under sustained load.
                        </Typography>
                      </Box>

                      <Box
                        component="button"
                        type="button"
                        onClick={() => setMachineType("performance")}
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 0.5,
                          p: 1.75,
                          minHeight: 44,
                          borderRadius: "var(--cd-radius-control)",
                          border:
                            machineType === "performance"
                              ? "2px solid var(--cd-accent)"
                              : "1px solid var(--cd-border)",
                          bgcolor:
                            machineType === "performance"
                              ? "var(--cd-accent-tint)"
                              : "var(--cd-surface)",
                          cursor: "pointer",
                          textAlign: "left",
                          color: "var(--cd-ink)",
                          fontFamily: "var(--font-sans)",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 1,
                          }}
                        >
                          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <Typography
                              sx={{
                                fontSize: 14,
                                fontWeight: machineType === "performance" ? 700 : 600,
                              }}
                            >
                              Dedicated CPU
                            </Typography>
                            <Typography sx={{ fontSize: 12, fontWeight: 600, color: "var(--cd-cost)" }}>
                              +$29/mo
                            </Typography>
                          </Stack>
                          {machineType === "performance" && (
                            <Check style={{ width: 16, height: 16, color: "var(--cd-accent)", flexShrink: 0 }} />
                          )}
                        </Box>
                        <Typography sx={{ fontSize: 12.5, color: "var(--cd-muted)", lineHeight: 1.45 }}>
                          Dedicated CPU. Full cores, no throttling. For production.
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  {/* RAM Grid */}
                  <Box>
                    <FieldLabel label="Memory (RAM)" required />
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)" },
                        gap: 1,
                      }}
                    >
                      {RAM_OPTIONS.map((opt) => {
                        const isSelected = ramMb === opt.value;
                        return (
                          <Box
                            key={opt.value}
                            component="button"
                            type="button"
                            onClick={() => setRamMb(opt.value)}
                            sx={{
                              minHeight: 44,
                              px: 1.5,
                              py: 1,
                              borderRadius: "var(--cd-radius-control)",
                              border: isSelected
                                ? "2px solid var(--cd-accent)"
                                : "1px solid var(--cd-border)",
                              bgcolor: isSelected ? "var(--cd-accent-tint)" : "var(--cd-surface)",
                              color: "var(--cd-ink)",
                              cursor: "pointer",
                              fontFamily: "var(--font-sans)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 0.75,
                            }}
                          >
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                              {isSelected && (
                                <Check style={{ width: 14, height: 14, color: "var(--cd-accent)", flexShrink: 0 }} />
                              )}
                              <Typography sx={{ fontSize: 13.5, fontWeight: isSelected ? 700 : 500 }}>
                                {opt.label}
                              </Typography>
                            </Stack>
                            {opt.deltaLabel && (
                              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--cd-cost)" }}>
                                {opt.deltaLabel}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>

                  {/* CPU Grid */}
                  <Box>
                    <FieldLabel label="CPU" required />
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" },
                        gap: 1,
                      }}
                    >
                      {CPU_OPTIONS.map((opt) => {
                        const isSelected = cpus === opt.value;
                        return (
                          <Box
                            key={opt.value}
                            component="button"
                            type="button"
                            onClick={() => setCpus(opt.value)}
                            sx={{
                              minHeight: 44,
                              px: 1.25,
                              py: 1,
                              borderRadius: "var(--cd-radius-control)",
                              border: isSelected
                                ? "2px solid var(--cd-accent)"
                                : "1px solid var(--cd-border)",
                              bgcolor: isSelected ? "var(--cd-accent-tint)" : "var(--cd-surface)",
                              color: "var(--cd-ink)",
                              cursor: "pointer",
                              fontFamily: "var(--font-sans)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 0.5,
                            }}
                          >
                            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                              {isSelected && (
                                <Check style={{ width: 14, height: 14, color: "var(--cd-accent)", flexShrink: 0 }} />
                              )}
                              <Typography sx={{ fontSize: 13.5, fontWeight: isSelected ? 700 : 500 }}>
                                {opt.label}
                              </Typography>
                            </Stack>
                            {opt.deltaLabel && (
                              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "var(--cd-cost)" }}>
                                {opt.deltaLabel}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>

                  {/* Disk Segmented Row */}
                  <Box>
                    <FieldLabel label="Disk" optional />
                    <Box
                      role="radiogroup"
                      aria-label="Disk size"
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        borderRadius: "var(--cd-radius-control)",
                        border: "1px solid var(--cd-border)",
                        bgcolor: "var(--cd-surface)",
                        overflow: "hidden",
                      }}
                    >
                      {VOLUME_OPTIONS.map((opt, idx) => {
                        const isSelected = volumeGb === opt.value;
                        return (
                          <Box
                            key={opt.value}
                            component="button"
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => setVolumeGb(opt.value)}
                            sx={{
                              minHeight: 44,
                              px: 0.5,
                              py: 0.75,
                              border: "none",
                              borderRight:
                                idx < VOLUME_OPTIONS.length - 1
                                  ? "1px solid var(--cd-border)"
                                  : "none",
                              bgcolor: isSelected ? "var(--cd-accent-tint)" : "transparent",
                              boxShadow: isSelected ? "inset 0 0 0 2px var(--cd-accent)" : "none",
                              color: "var(--cd-ink)",
                              cursor: "pointer",
                              fontFamily: "var(--font-sans)",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              lineHeight: 1.2,
                            }}
                          >
                            <Typography
                              sx={{
                                fontSize: 13,
                                fontWeight: isSelected ? 700 : 500,
                                color: isSelected ? "var(--cd-accent)" : "var(--cd-ink)",
                              }}
                            >
                              {opt.label}
                            </Typography>
                            {opt.deltaLabel && (
                              <Typography
                                sx={{
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  color: "var(--cd-cost)",
                                  mt: 0.25,
                                }}
                              >
                                {opt.deltaLabel}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                      {volumeGb === 0
                        ? "Ephemeral storage. Data resets on every deploy."
                        : `Persistent ${volumeGb} GB disk mounted for stateful data across deploys.`}
                    </Typography>
                  </Box>

                  {/* Region */}
                  <Box>
                    <FieldLabel htmlFor="region-select" label="Region" required />
                    <Select
                      id="region-select"
                      size="small"
                      fullWidth
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      sx={{
                        minHeight: 44,
                        borderRadius: "var(--cd-radius-control)",
                        bgcolor: "var(--cd-surface)",
                        color: "var(--cd-ink)",
                        fontSize: 14,
                        "& .MuiOutlinedInput-notchedOutline": {
                          borderColor: "var(--cd-border)",
                        },
                        "&:hover .MuiOutlinedInput-notchedOutline": {
                          borderColor: "var(--cd-muted)",
                        },
                        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                          borderColor: "var(--cd-accent)",
                          borderWidth: "2px",
                        },
                      }}
                    >
                      {FLY_REGIONS.map(({ code, name: rName }) => (
                        <MenuItem key={code} value={code} sx={{ minHeight: 44, fontSize: 14 }}>
                          {rName} ({code.toUpperCase()})
                        </MenuItem>
                      ))}
                    </Select>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                      Singapore (SIN) gives the lowest latency from Bangladesh.
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              {/* Mobile Inline Summary Row (above sticky bottom CTA bar) */}
              <Box
                sx={{
                  display: { xs: "flex", lg: "none" },
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.5,
                  mt: 3,
                  p: 2,
                  borderRadius: "var(--cd-radius-container)",
                  border: "1px solid var(--cd-border)",
                  bgcolor: "var(--cd-surface)",
                }}
              >
                <Typography sx={{ fontSize: 13, color: "var(--cd-muted)", lineHeight: 1.4 }}>
                  {specSummaryLine}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: isFreeTier ? "var(--cd-free)" : "var(--cd-ink)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {monthlyCostLabel}
                </Typography>
              </Box>
            </Box>

            {/* Desktop Sticky Right Summary Panel */}
            <Box
              sx={{
                display: { xs: "none", lg: "block" },
                position: "sticky",
                top: 24,
                mt: 3,
                p: 2.5,
                borderRadius: "var(--cd-radius-container)",
                border: "1px solid var(--cd-border)",
                bgcolor: "var(--cd-surface)",
              }}
            >
              <Typography sx={{ fontSize: 16, fontWeight: 700, color: "var(--cd-ink)", mb: 1.5 }}>
                Summary
              </Typography>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 1.5,
                  pb: 2,
                  borderBottom: "1px solid var(--cd-border)",
                }}
              >
                <Typography sx={{ fontSize: 13, color: "var(--cd-muted)", lineHeight: 1.45 }}>
                  {specSummaryLine}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: isFreeTier ? "var(--cd-free)" : "var(--cd-ink)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {monthlyCostLabel}
                </Typography>
              </Box>

              <Stack spacing={1} sx={{ py: 2, fontSize: 13 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <span style={{ color: "var(--cd-muted)" }}>Compute</span>
                  <span style={{ fontWeight: 600 }}>
                    {machineType === "shared" ? "Shared CPU" : "Dedicated CPU"}
                  </span>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <span style={{ color: "var(--cd-muted)" }}>Memory</span>
                  <span style={{ fontWeight: 600 }}>{formatRamLabel(ramMb)}</span>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <span style={{ color: "var(--cd-muted)" }}>CPU</span>
                  <span style={{ fontWeight: 600 }}>{cpus} vCPU</span>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <span style={{ color: "var(--cd-muted)" }}>Disk</span>
                  <span style={{ fontWeight: 600 }}>
                    {volumeGb > 0 ? `${volumeGb} GB` : "Ephemeral"}
                  </span>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <span style={{ color: "var(--cd-muted)" }}>Region</span>
                  <span style={{ fontWeight: 600 }}>{selectedRegionName}</span>
                </Box>
              </Stack>

              {disabledReason && (
                <Typography sx={{ fontSize: 12.5, color: "var(--cd-muted)", mb: 1 }}>
                  {disabledReason}
                </Typography>
              )}

              <Button
                type="button"
                variant="contained"
                fullWidth
                onClick={() => void handleProceedToAnalysis()}
                disabled={!isConfigureReady}
                endIcon={<ArrowRight style={{ width: 16, height: 16 }} />}
                sx={{
                  minHeight: 44,
                  borderRadius: "var(--cd-radius-control)",
                  bgcolor: "var(--cd-accent)",
                  color: "var(--cd-accent-ink)",
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: "none",
                  "&:hover": {
                    bgcolor: "var(--cd-accent)",
                    opacity: 0.92,
                    boxShadow: "none",
                  },
                  "&.Mui-disabled": {
                    bgcolor: "var(--cd-surface-alt)",
                    color: "var(--cd-muted)",
                    border: "1px solid var(--cd-border)",
                  },
                }}
              >
                {primaryConfigureCta}
              </Button>
            </Box>
          </Box>
        )}

        {/* Mobile Sticky Bottom Action Bar (Step 1) */}
        {step === "configure" && (
          <Box
            sx={{
              display: { xs: "block", lg: "none" },
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 30,
              bgcolor: "var(--cd-canvas)",
              borderTop: "1px solid var(--cd-border)",
              px: 2,
              pt: 1.25,
              pb: "calc(12px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {disabledReason && (
              <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mb: 0.75, textAlign: "center" }}>
                {disabledReason}
              </Typography>
            )}
            <Button
              type="button"
              variant="contained"
              fullWidth
              onClick={() => void handleProceedToAnalysis()}
              disabled={!isConfigureReady}
              endIcon={<ArrowRight style={{ width: 16, height: 16 }} />}
              sx={{
                minHeight: 44,
                borderRadius: "var(--cd-radius-control)",
                bgcolor: "var(--cd-accent)",
                color: "var(--cd-accent-ink)",
                fontSize: 14,
                fontWeight: 700,
                boxShadow: "none",
                "&:hover": {
                  bgcolor: "var(--cd-accent)",
                  opacity: 0.92,
                  boxShadow: "none",
                },
                "&.Mui-disabled": {
                  bgcolor: "var(--cd-surface-alt)",
                  color: "var(--cd-muted)",
                  border: "1px solid var(--cd-border)",
                },
              }}
            >
              {primaryConfigureCta}
            </Button>
          </Box>
        )}

        {/* =========================================================================
            STEP 2: REVIEW & DEPLOYABLE PATH
        ========================================================================= */}
        {step === "analyze" && (
          <Box sx={{ maxWidth: 760 }}>
            {sourceType === "github" && (
              <Box sx={sectionDividerSx}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1.5,
                    mb: 2,
                  }}
                >
                  <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
                    Repository analysis
                  </Typography>
                  {isAnalyzingRepo && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "var(--cd-accent)" }}>
                      <CircularProgress size={14} color="inherit" />
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Scanning…</Typography>
                    </Stack>
                  )}
                </Box>

                {isAnalyzingRepo ? (
                  <Stack
                    spacing={1.5}
                    sx={{
                      alignItems: "center",
                      justifyContent: "center",
                      py: 5,
                      px: 2,
                      borderRadius: "var(--cd-radius-container)",
                      border: "1px dashed var(--cd-border)",
                      bgcolor: "var(--cd-surface)",
                      textAlign: "center",
                    }}
                  >
                    <CircularProgress size={26} sx={{ color: "var(--cd-accent)" }} />
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      Scanning repository for build tools and deployable paths
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: "var(--cd-muted)" }}>
                      Checking package.json, Dockerfiles, and workspace roots.
                    </Typography>
                  </Stack>
                ) : (
                  <Stack spacing={2}>
                    {discoveryError && (
                      <Stack
                        direction="row"
                        spacing={1}
                        role="alert"
                        sx={{
                          alignItems: "center",
                          borderRadius: "var(--cd-radius-control)",
                          border: "1px solid var(--cd-danger)",
                          bgcolor: "var(--cd-danger-tint)",
                          p: 1.5,
                          fontSize: 13,
                          color: "var(--cd-danger)",
                        }}
                      >
                        <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                        <span>{discoveryError}</span>
                      </Stack>
                    )}

                    {discoveryResult?.candidates && discoveryResult.candidates.length > 0 ? (
                      <Stack spacing={1.25}>
                        <Typography sx={{ fontSize: 13, color: "var(--cd-muted)" }}>
                          {discoveryResult.monorepo
                            ? "Monorepo detected. Choose the service directory to deploy:"
                            : "Detected service:"}
                        </Typography>
                        {discoveryResult.candidates.map((cand) => {
                          const isSelected = selectedCandidateId === cand.id;
                          const techTags = [
                            cand.frameworkName,
                            cand.language ? cand.language.toUpperCase() : null,
                            cand.packageManager,
                            cand.dockerfilePath ? "Dockerfile" : null,
                          ].filter(Boolean);

                          return (
                            <Box
                              key={cand.id}
                              component="button"
                              type="button"
                              onClick={() => {
                                setSelectedCandidateId(cand.id);
                                setCustomRootDirectory(cand.rootDirectory);
                              }}
                              sx={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 0.75,
                                p: 1.75,
                                minHeight: 44,
                                borderRadius: "var(--cd-radius-container)",
                                border: isSelected
                                  ? "2px solid var(--cd-accent)"
                                  : "1px solid var(--cd-border)",
                                bgcolor: isSelected ? "var(--cd-accent-tint)" : "var(--cd-surface)",
                                cursor: "pointer",
                                textAlign: "left",
                                color: "var(--cd-ink)",
                                fontFamily: "var(--font-sans)",
                              }}
                            >
                              <Box
                                sx={{
                                  display: "flex",
                                  width: "100%",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  gap: 1,
                                }}
                              >
                                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                  {isSelected ? (
                                    <Check style={{ width: 16, height: 16, color: "var(--cd-accent)" }} />
                                  ) : (
                                    <FolderGit2 style={{ width: 16, height: 16, color: "var(--cd-muted)" }} />
                                  )}
                                  <Typography sx={{ fontSize: 14, fontWeight: isSelected ? 700 : 600 }}>
                                    {cand.name}
                                  </Typography>
                                </Stack>
                                <Box
                                  component="code"
                                  sx={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 12,
                                    color: "var(--cd-muted)",
                                  }}
                                >
                                  {cand.rootDirectory === "." ? "./" : cand.rootDirectory}
                                </Box>
                              </Box>

                              {techTags.length > 0 && (
                                <Typography sx={{ fontSize: 12.5, color: "var(--cd-muted)", pl: 3 }}>
                                  {techTags.join(" · ")}
                                </Typography>
                              )}
                            </Box>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Typography sx={{ fontSize: 13.5, color: "var(--cd-muted)" }}>
                        Root directory{" "}
                        <Box component="code" sx={{ fontFamily: "var(--font-mono)", color: "var(--cd-ink)" }}>
                          ./
                        </Box>{" "}
                        will be built automatically.
                      </Typography>
                    )}

                    <Box sx={{ pt: 1 }}>
                      <FieldLabel htmlFor="custom-root-dir" label="Root directory" optional />
                      <TextField
                        id="custom-root-dir"
                        size="small"
                        fullWidth
                        placeholder="."
                        value={customRootDirectory}
                        onChange={(e) => setCustomRootDirectory(e.target.value)}
                        sx={inputSx}
                        slotProps={{
                          htmlInput: {
                            sx: {
                              fontFamily: customRootDirectory ? "var(--font-mono)" : "var(--font-sans)",
                              fontSize: 13.5,
                            },
                          },
                        }}
                      />
                      <Typography sx={{ fontSize: 12, color: "var(--cd-muted)", mt: 0.75 }}>
                        Path relative to the repository root. Keep &ldquo;.&rdquo; for single-app repos.
                      </Typography>
                    </Box>
                  </Stack>
                )}
              </Box>
            )}

            {/* Review Summary */}
            <Box sx={{ py: 3 }}>
              <Box
                sx={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 1.5,
                  mb: 2,
                }}
              >
                <Typography sx={{ fontSize: 16, fontWeight: 700 }}>Review configuration</Typography>
                <Typography
                  sx={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: isFreeTier ? "var(--cd-free)" : "var(--cd-ink)",
                  }}
                >
                  {monthlyCostLabel}
                </Typography>
              </Box>

              <Box
                sx={{
                  p: 2,
                  borderRadius: "var(--cd-radius-container)",
                  border: "1px solid var(--cd-border)",
                  bgcolor: "var(--cd-surface)",
                }}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                    gap: 2,
                  }}
                >
                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)" }}>App name</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 600, mt: 0.25 }}>{name}</Typography>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)" }}>Live URL</Typography>
                    <Typography
                      sx={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        color: "var(--cd-accent)",
                        mt: 0.25,
                        wordBreak: "break-all",
                      }}
                    >
                      {previewDomainUrl}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)" }}>Source</Typography>
                    <Typography
                      sx={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        mt: 0.25,
                        wordBreak: "break-all",
                      }}
                    >
                      {sourceType === "github"
                        ? repoUrl
                        : dockerParsed
                          ? dockerParsed.cleanedImage
                          : dockerInputRaw}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)" }}>
                      {sourceType === "github" ? "Deployable path" : "Container root"}
                    </Typography>
                    <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, mt: 0.25 }}>
                      {sourceType === "github" ? customRootDirectory || "." : "/"}
                    </Typography>
                  </Box>

                  <Box sx={{ gridColumn: { sm: "1 / -1" } }}>
                    <Typography sx={{ fontSize: 12, color: "var(--cd-muted)" }}>Resources</Typography>
                    <Typography sx={{ fontSize: 14, fontWeight: 500, mt: 0.25 }}>
                      {machineType === "shared" ? "Shared CPU" : "Dedicated CPU"} · {specSummaryLine}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* Step 2 Actions */}
              <Stack
                direction={{ xs: "column-reverse", sm: "row" }}
                spacing={1.5}
                sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mt: 3 }}
              >
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => setStep("configure")}
                  disabled={deployMutation.isPending}
                  startIcon={<ArrowLeft style={{ width: 16, height: 16 }} />}
                  sx={{
                    minHeight: 44,
                    borderRadius: "var(--cd-radius-control)",
                    borderColor: "var(--cd-border)",
                    color: "var(--cd-ink)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  Back to configure
                </Button>

                <Button
                  type="button"
                  variant="contained"
                  onClick={() => deployMutation.mutate()}
                  disabled={deployMutation.isPending || isAnalyzingRepo}
                  startIcon={
                    deployMutation.isPending ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <Rocket style={{ width: 16, height: 16 }} />
                    )
                  }
                  sx={{
                    minHeight: 44,
                    px: 3.5,
                    borderRadius: "var(--cd-radius-control)",
                    bgcolor: "var(--cd-accent)",
                    color: "var(--cd-accent-ink)",
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow: "none",
                    "&:hover": {
                      bgcolor: "var(--cd-accent)",
                      opacity: 0.92,
                      boxShadow: "none",
                    },
                    "&.Mui-disabled": {
                      bgcolor: "var(--cd-surface-alt)",
                      color: "var(--cd-muted)",
                      border: "1px solid var(--cd-border)",
                    },
                  }}
                >
                  {deployMutation.isPending ? "Deploying app…" : "Deploy app"}
                </Button>
              </Stack>
            </Box>
          </Box>
        )}

        {/* =========================================================================
            STEP 3: DEPLOYMENT & LIVE LOGS
        ========================================================================= */}
        {step === "deploying" && (
          <Stack spacing={3} sx={{ pt: 3 }}>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 2,
                pb: 2.5,
                borderBottom: "1px solid var(--cd-border)",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{name}</Typography>
                <Typography
                  sx={{
                    fontSize: 13,
                    color: "var(--cd-muted)",
                    mt: 0.5,
                    wordBreak: "break-all",
                  }}
                >
                  <Box component="span" sx={{ fontFamily: "var(--font-mono)" }}>
                    {sourceType === "github" ? repoUrl : dockerInputRaw}
                  </Box>{" "}
                  · {selectedRegionName} ({region.toUpperCase()})
                </Typography>
              </Box>

              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {activeDeploymentId && (
                  <Button
                    component={Link}
                    href={`/deployments/${activeDeploymentId}`}
                    variant="outlined"
                    size="small"
                    endIcon={<ExternalLink style={{ width: 14, height: 14 }} />}
                    sx={{
                      minHeight: 44,
                      borderRadius: "var(--cd-radius-control)",
                      borderColor: "var(--cd-border)",
                      color: "var(--cd-ink)",
                    }}
                  >
                    Deployment details
                  </Button>
                )}
                {activeAppId && (
                  <Button
                    component={Link}
                    href={`/apps/${activeAppId}`}
                    variant="contained"
                    size="small"
                    endIcon={<ExternalLink style={{ width: 14, height: 14 }} />}
                    sx={{
                      minHeight: 44,
                      borderRadius: "var(--cd-radius-control)",
                      bgcolor: "var(--cd-accent)",
                      color: "var(--cd-accent-ink)",
                      boxShadow: "none",
                    }}
                  >
                    Open app
                  </Button>
                )}
                <Button
                  component={Link}
                  href="/apps"
                  variant="outlined"
                  size="small"
                  sx={{
                    minHeight: 44,
                    borderRadius: "var(--cd-radius-control)",
                    borderColor: "var(--cd-border)",
                    color: "var(--cd-ink)",
                  }}
                >
                  All apps
                </Button>
              </Stack>
            </Box>

            {activePublicUrl && (
              <Box>
                <FieldLabel label="Public URL" />
                <CopyField value={activePublicUrl} />
              </Box>
            )}

            {activeDeploymentId ? (
              <DeploymentLogsViewer
                deploymentId={activeDeploymentId}
                initialStatus="building"
                buildNumber={1}
              />
            ) : (
              <Stack
                spacing={1.5}
                sx={{
                  alignItems: "center",
                  justifyContent: "center",
                  p: 5,
                  borderRadius: "var(--cd-radius-container)",
                  border: "1px solid var(--cd-border)",
                  bgcolor: "var(--cd-surface)",
                  textAlign: "center",
                }}
              >
                <CircularProgress size={28} sx={{ color: "var(--cd-accent)" }} />
                <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
                  Provisioning container machine
                </Typography>
                <Typography sx={{ fontSize: 13, color: "var(--cd-muted)" }}>
                  Allocating IP, configuring ports, and starting instance in {selectedRegionName}.
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>

      {/* GitHub Account Connect Dialog */}
      <ConnectGitHubDialog
        open={isConnectDialogOpen}
        onClose={() => setIsConnectDialogOpen(false)}
        onSuccess={handleGitHubConnected}
      />
    </Box>
  );
}

const queryClient = new QueryClient();

export function CreateApplicationPageProvider() {
  return (
    <QueryClientProvider client={queryClient}>
      <CreateApplicationContent />
    </QueryClientProvider>
  );
}
