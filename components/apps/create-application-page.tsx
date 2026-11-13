"use client";

import * as React from "react";
import { useEffect, useState, useTransition } from "react";
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box as BoxIcon,
  Check,
  CheckCircle2,
  ChevronRight,
  Cpu,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Unplug,
} from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
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
  type DiscoveredProjectCandidate,
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
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyField } from "@/components/shared/copy-field";

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

const cardSx = {
  borderRadius: 2.5,
  border: "1px solid var(--border)",
  bgcolor: "var(--card)",
  p: { xs: 2, sm: 3 },
} as const;

const cardHeaderSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1.5,
  pb: 1.5,
  borderBottom: "1px solid var(--border)",
} as const;

type Step = "configure" | "analyze" | "deploying";

// Machine sizing options
const RAM_OPTIONS = [
  { value: 256, label: "256 MB", isFree: true },
  { value: 512, label: "512 MB", isFree: false },
  { value: 1024, label: "1 GB", isFree: false },
  { value: 2048, label: "2 GB", isFree: false },
  { value: 4096, label: "4 GB", isFree: false },
  { value: 8192, label: "8 GB", isFree: false },
];

const CPU_OPTIONS = [
  { value: 1, label: "1 vCPU", isFree: false },
  { value: 2, label: "2 vCPU", isFree: true },
  { value: 4, label: "4 vCPU", isFree: false },
  { value: 8, label: "8 vCPU", isFree: false },
];

const VOLUME_OPTIONS = [
  { value: 0, label: "None (Ephemeral)", isFree: true },
  { value: 1, label: "1 GB Disk", isFree: false },
  { value: 3, label: "3 GB Disk", isFree: false },
  { value: 5, label: "5 GB Disk", isFree: false },
  { value: 10, label: "10 GB Disk", isFree: false },
];

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
        setGhConnected(res.connected);
        setGhUsername(res.username);
        setGhRepos(res.repos);
        if (res.connected && res.repos.length > 0) {
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
      setDeployError("Please provide an application name.");
      return;
    }

    if (sourceType === "github") {
      const trimmedUrl = repoUrl.trim();
      if (!trimmedUrl) {
        setDeployError("Please enter or select a GitHub repository.");
        return;
      }
      setStep("analyze");
      const branchToUse = repoBranch.trim() || repoPreview?.defaultBranch || "main";
      void runAutoAnalysis(trimmedUrl, branchToUse);
    } else {
      const cleanImg = dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw.trim();
      if (!cleanImg) {
        setDeployError("Please enter a Docker container image or pick a template.");
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

  const selectedRegionObj = FLY_REGIONS.find((r) => r.code === region);
  const selectedRegionName = selectedRegionObj?.name || region;

  const filteredRepos = ghRepos.filter((r) =>
    r.fullName.toLowerCase().includes(repoSearch.toLowerCase()),
  );

  const selectedCandidate = discoveryResult?.candidates.find(
    (c) => c.id === selectedCandidateId,
  );

  return (
    <Box sx={{ mx: "auto", width: "100%", maxWidth: 1040, pb: 10, px: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={3.5}>
        {/* Navigation Breadcrumb / Header */}
        <Box>
          <Button
            component={Link}
            href="/apps"
            variant="text"
            size="small"
            startIcon={<ArrowLeft style={{ width: 16, height: 16 }} />}
            sx={{ ml: -1, color: "var(--muted-foreground)", mb: 1 }}
          >
            Back to Apps
          </Button>

          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              gap: 2,
              borderBottom: "1px solid var(--border)",
              pb: 2.5,
            }}
          >
            <Box>
              <Typography
                variant="h1"
                sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 700, letterSpacing: "-0.02em" }}
              >
                Create New Application
              </Typography>
              <Typography sx={{ fontSize: 13, color: "var(--muted-foreground)", mt: 0.5 }}>
                Deploy web services and background workers from GitHub or Docker with automated builds and free SSL.
              </Typography>
            </Box>

            {/* Stepper Pill Indicators */}
            <Stack
              direction="row"
              spacing={1}
              sx={{
                borderRadius: 99,
                bgcolor: "var(--muted)",
                p: 0.5,
                fontSize: 12,
                border: "1px solid var(--border)",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 99,
                  fontWeight: 600,
                  bgcolor: step === "configure" ? "var(--primary)" : "transparent",
                  color: step === "configure" ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  cursor: step !== "deploying" ? "pointer" : "default",
                }}
                onClick={() => {
                  if (step !== "deploying") setStep("configure");
                }}
              >
                1. Configure
              </Box>
              <Box
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 99,
                  fontWeight: 600,
                  bgcolor: step === "analyze" ? "var(--primary)" : "transparent",
                  color: step === "analyze" ? "var(--primary-foreground)" : "var(--muted-foreground)",
                }}
              >
                2. Analyze &amp; Path
              </Box>
              <Box
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 99,
                  fontWeight: 600,
                  bgcolor: step === "deploying" ? "var(--primary)" : "transparent",
                  color: step === "deploying" ? "var(--primary-foreground)" : "var(--muted-foreground)",
                }}
              >
                3. Deploy &amp; Live Logs
              </Box>
            </Stack>
          </Box>
        </Box>

        {deployError && (
          <Stack
            direction="row"
            spacing={1.25}
            sx={{
              alignItems: "center",
              borderRadius: 2,
              border: "1px solid rgba(239,68,68,0.3)",
              bgcolor: "rgba(239,68,68,0.08)",
              p: 2,
              color: "var(--destructive)",
              fontSize: 13,
            }}
          >
            <AlertCircle style={{ width: 18, height: 18, flexShrink: 0 }} />
            <span>{deployError}</span>
          </Stack>
        )}

        {/* =========================================================================
            STEP 1: CONFIGURE (APP NAME, SOURCE, MACHINE SPECS)
        ========================================================================= */}
        {step === "configure" && (
          <Stack spacing={3.5}>
            {/* 1. App Name */}
            <Stack spacing={2} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Server style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>App Name &amp; Identity</Typography>
                </Stack>
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Step 1 of 2</Typography>
              </Box>

              <Box>
                <Typography component="label" htmlFor="app-name-input" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                  Application Name *
                </Typography>
                <TextField
                  id="app-name-input"
                  size="small"
                  fullWidth
                  autoComplete="off"
                  placeholder="my-cool-service"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13.5 } } }}
                />
                <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Target URL preview:</Typography>
                  <Box
                    component="code"
                    sx={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      bgcolor: "var(--muted)",
                      color: "var(--primary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    https://{name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "my-cool-service"}-[id].fly.dev
                  </Box>
                </Box>
              </Box>
            </Stack>

            {/* 2. Source Tabs (GitHub vs Docker) */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Layers style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Source Code &amp; Packaging</Typography>
                </Stack>
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Select source tab
                </Typography>
              </Box>

              {/* Segmented Source Tabs */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 1.5,
                  p: 0.5,
                  borderRadius: 2,
                  bgcolor: "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                <Box
                  component="button"
                  type="button"
                  onClick={() => setSourceType("github")}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    py: 1.25,
                    px: 2,
                    borderRadius: 1.5,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13.5,
                    bgcolor: sourceType === "github" ? "var(--card)" : "transparent",
                    color: sourceType === "github" ? "var(--foreground)" : "var(--muted-foreground)",
                    boxShadow: sourceType === "github" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    transition: "all 150ms ease",
                  }}
                >
                  <GitHubIcon size={16} />
                  <span>GitHub Repository</span>
                </Box>

                <Box
                  component="button"
                  type="button"
                  onClick={() => setSourceType("docker")}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    py: 1.25,
                    px: 2,
                    borderRadius: 1.5,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13.5,
                    bgcolor: sourceType === "docker" ? "var(--card)" : "transparent",
                    color: sourceType === "docker" ? "var(--foreground)" : "var(--muted-foreground)",
                    boxShadow: sourceType === "docker" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    transition: "all 150ms ease",
                  }}
                >
                  <BoxIcon style={{ width: 16, height: 16 }} />
                  <span>Docker Image</span>
                </Box>
              </Box>

              {/* GitHub Tab Content */}
              {sourceType === "github" && (
                <Stack spacing={2.5} sx={{ pt: 1 }}>
                  {/* Connected Status or Connect Button */}
                  <Box
                    sx={{
                      display: "flex",
                      flexDirection: { xs: "column", sm: "row" },
                      alignItems: { xs: "flex-start", sm: "center" },
                      justifyContent: "space-between",
                      gap: 1.5,
                      borderRadius: 2,
                      border: "1px solid var(--border)",
                      bgcolor: ghConnected ? "rgba(16,185,129,0.06)" : "var(--muted)",
                      p: 2,
                    }}
                  >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <Box
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          bgcolor: "var(--background)",
                          border: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <GitHubIcon size={18} />
                      </Box>
                      <Box>
                        {ghConnected ? (
                          <>
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                                Connected to GitHub
                              </Typography>
                              <Chip
                                size="small"
                                label={`@${ghUsername}`}
                                sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: "rgba(16,185,129,0.15)", color: "#10b981" }}
                              />
                            </Stack>
                            <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.25 }}>
                              {ghRepos.length} repositories loaded from your GitHub account.
                            </Typography>
                          </>
                        ) : (
                          <>
                            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                              GitHub Account Not Connected
                            </Typography>
                            <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.25 }}>
                              Connect your account to pick private or org repos, or paste any public repository URL below.
                            </Typography>
                          </>
                        )}
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}>
                      {ghConnected ? (
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          color="inherit"
                          onClick={() => void handleDisconnectGitHub()}
                          startIcon={<Unplug style={{ width: 14, height: 14 }} />}
                          sx={{ fontSize: 12 }}
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="contained"
                          size="small"
                          onClick={() => setIsConnectDialogOpen(true)}
                          startIcon={<GitHubIcon size={14} />}
                          sx={{ fontSize: 12 }}
                        >
                          Connect GitHub
                        </Button>
                      )}
                    </Stack>
                  </Box>

                  {/* If connected: Show repository selector or search */}
                  {ghConnected && ghRepos.length > 0 && !showManualUrl && (
                    <Stack spacing={1.5}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                          Select from your GitHub Repositories:
                        </Typography>
                        <Button
                          type="button"
                          variant="text"
                          size="small"
                          onClick={() => setShowManualUrl(true)}
                          sx={{ fontSize: 11.5, p: 0 }}
                        >
                          Paste a custom URL instead
                        </Button>
                      </Box>

                      <TextField
                        size="small"
                        placeholder="Search your repositories…"
                        value={repoSearch}
                        onChange={(e) => setRepoSearch(e.target.value)}
                        slotProps={{
                          input: {
                            startAdornment: (
                              <Search style={{ width: 14, height: 14, marginRight: 8, color: "var(--muted-foreground)" }} />
                            ),
                          },
                        }}
                      />

                      <Box
                        sx={{
                          maxHeight: 220,
                          overflowY: "auto",
                          borderRadius: 2,
                          border: "1px solid var(--border)",
                          bgcolor: "var(--background)",
                        }}
                      >
                        {filteredRepos.length === 0 ? (
                          <Box sx={{ p: 2, textAlign: "center", color: "var(--muted-foreground)", fontSize: 12 }}>
                            No matching repositories found.
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
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  p: 1.5,
                                  borderBottom: "1px solid var(--border)",
                                  borderLeft: isSelected ? "3px solid var(--primary)" : "3px solid transparent",
                                  bgcolor: isSelected ? "rgba(59,130,246,0.08)" : "transparent",
                                  textAlign: "left",
                                  cursor: "pointer",
                                  color: "inherit",
                                  "&:hover": { bgcolor: "var(--muted)" },
                                  "&:last-child": { borderBottom: "none" },
                                }}
                              >
                                <Box>
                                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                    <FolderGit2 style={{ width: 14, height: 14, color: "var(--primary)" }} />
                                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{repo.fullName}</Typography>
                                    {repo.isPrivate && (
                                      <Chip label="Private" size="small" sx={{ height: 18, fontSize: 10 }} />
                                    )}
                                  </Stack>
                                  {repo.description && (
                                    <Typography noWrap sx={{ fontSize: 11.5, color: "var(--muted-foreground)", mt: 0.25, maxWidth: 420 }}>
                                      {repo.description}
                                    </Typography>
                                  )}
                                </Box>

                                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                  <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>
                                    {repo.defaultBranch}
                                  </Typography>
                                  {isSelected && <CheckCircle2 style={{ width: 16, height: 16, color: "var(--primary)" }} />}
                                </Stack>
                              </Box>
                            );
                          })
                        )}
                      </Box>
                    </Stack>
                  )}

                  {/* Public Repository URL Input */}
                  {(showManualUrl || !ghConnected || ghRepos.length === 0) && (
                    <Box>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
                        <Typography component="label" htmlFor="repo-url-input" sx={{ fontSize: 12.5, fontWeight: 500 }}>
                          Public GitHub Repository URL *
                        </Typography>
                        {ghConnected && ghRepos.length > 0 && (
                          <Button
                            type="button"
                            variant="text"
                            size="small"
                            onClick={() => setShowManualUrl(false)}
                            sx={{ fontSize: 11.5, p: 0 }}
                          >
                            Pick from my repositories
                          </Button>
                        )}
                      </Box>

                      <Stack direction="row" spacing={1}>
                        <TextField
                          id="repo-url-input"
                          type="url"
                          size="small"
                          fullWidth
                          placeholder="https://github.com/username/repository"
                          value={repoUrl}
                          onChange={(e) => {
                            setRepoUrl(e.target.value);
                            setRepoPreview(null);
                            setRepoError(null);
                          }}
                          onBlur={() => void handleValidateGitHub()}
                          slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
                        />
                        <Button
                          type="button"
                          variant="outlined"
                          size="small"
                          onClick={() => void handleValidateGitHub()}
                          disabled={isValidatingRepo || !repoUrl.trim()}
                          sx={{ flexShrink: 0, px: 2 }}
                        >
                          {isValidatingRepo ? <CircularProgress size={14} /> : "Verify"}
                        </Button>
                      </Stack>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                        Enter any public GitHub repository. Next step will automatically scan and detect deployable paths.
                      </Typography>
                    </Box>
                  )}

                  {repoError && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                        borderRadius: 1.5,
                        border: "1px solid rgba(239,68,68,0.25)",
                        bgcolor: "rgba(239,68,68,0.08)",
                        p: 1.5,
                        fontSize: 12.5,
                        color: "var(--destructive)",
                      }}
                    >
                      <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                      <span>{repoError}</span>
                    </Stack>
                  )}

                  {repoPreview && (
                    <Box
                      sx={{
                        borderRadius: 2,
                        border: "1px solid rgba(16,185,129,0.3)",
                        bgcolor: "rgba(16,185,129,0.05)",
                        p: 2,
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <GitBranch style={{ width: 16, height: 16, color: "#10b981" }} />
                          <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 13.5, fontWeight: 600 }}>
                            {repoPreview.owner}/{repoPreview.name}
                          </Typography>
                        </Stack>
                        <Chip
                          label="Verified Repo"
                          size="small"
                          sx={{ height: 20, bgcolor: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 600, fontSize: 11 }}
                        />
                      </Box>
                      <Box sx={{ display: "flex", gap: 2, mt: 1, fontSize: 12 }}>
                        <Typography sx={{ color: "var(--muted-foreground)" }}>
                          Default branch: <Box component="span" sx={{ color: "var(--foreground)", fontWeight: 600 }}>{repoPreview.defaultBranch}</Box>
                        </Typography>
                        <Typography sx={{ color: "var(--muted-foreground)" }}>
                          Type: <Box component="span" sx={{ color: "var(--foreground)", fontWeight: 600 }}>{repoPreview.fork ? "Fork" : "Source"}</Box>
                        </Typography>
                      </Box>
                    </Box>
                  )}

                  <Box>
                    <Typography component="label" htmlFor="repo-branch-input" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Branch (optional)
                    </Typography>
                    <TextField
                      id="repo-branch-input"
                      size="small"
                      fullWidth
                      placeholder={repoPreview?.defaultBranch || "main"}
                      value={repoBranch}
                      onChange={(e) => setRepoBranch(e.target.value)}
                      slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                    />
                  </Box>
                </Stack>
              )}

              {/* Docker Tab Content */}
              {sourceType === "docker" && (
                <Stack spacing={2.5} sx={{ pt: 1 }}>
                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mb: 1 }}>
                      Quick start with popular container templates:
                    </Typography>
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      {STARTER_TEMPLATES.map((tpl) => {
                        const active = selectedTemplate === tpl.name;
                        return (
                          <Button
                            key={tpl.name}
                            type="button"
                            size="small"
                            variant={active ? "contained" : "outlined"}
                            onClick={() => handleApplyTemplate(tpl)}
                            startIcon={active ? <Check style={{ width: 12, height: 12 }} /> : undefined}
                            sx={{ fontSize: 12 }}
                          >
                            {tpl.name}
                          </Button>
                        );
                      })}
                    </Stack>
                  </Box>

                  <Box>
                    <Typography component="label" htmlFor="docker-image-input" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Docker Image or Pull Command *
                    </Typography>
                    <TextField
                      id="docker-image-input"
                      size="small"
                      fullWidth
                      placeholder="nginx:alpine or docker pull ghcr.io/owner/repo:latest"
                      value={dockerInputRaw}
                      onChange={(e) => handleDockerInputChange(e.target.value)}
                      slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
                    />
                  </Box>

                  {dockerParsed && (
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderRadius: 2,
                        border: "1px solid var(--border)",
                        bgcolor: "var(--muted)",
                        p: 1.5,
                      }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <BoxIcon style={{ width: 16, height: 16, color: "var(--primary)" }} />
                        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{dockerParsed.registryLabel}</Typography>
                      </Stack>
                      <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
                        {dockerParsed.cleanedImage}
                      </Typography>
                    </Box>
                  )}

                  <Box>
                    <Typography component="label" htmlFor="docker-port-input" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Container Internal Port (optional)
                    </Typography>
                    <TextField
                      id="docker-port-input"
                      type="number"
                      size="small"
                      fullWidth
                      placeholder="Auto-detected (e.g. 80, 3000, 8080)"
                      value={internalPort}
                      onChange={(e) => setInternalPort(e.target.value)}
                    />
                  </Box>
                </Stack>
              )}
            </Stack>

            {/* 3. Machine Type & Resource Selectors */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Cpu style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Machine Type &amp; Resources</Typography>
                </Stack>
                {isFreeTier && (
                  <Chip
                    icon={<Sparkles style={{ width: 12, height: 12 }} />}
                    label="Free Tier Included"
                    size="small"
                    sx={{
                      bgcolor: "rgba(16,185,129,0.15)",
                      color: "#10b981",
                      fontWeight: 700,
                      fontSize: 11.5,
                      border: "1px solid rgba(16,185,129,0.3)",
                    }}
                  />
                )}
              </Box>

              {/* Machine Type Selection (Shared vs Performance) */}
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, mb: 1 }}>
                  Machine Type *
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => setMachineType("shared")}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      p: 2,
                      borderRadius: 2,
                      border: machineType === "shared" ? "2px solid var(--primary)" : "1px solid var(--border)",
                      bgcolor: machineType === "shared" ? "rgba(59,130,246,0.06)" : "var(--background)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "inherit",
                    }}
                  >
                    <Box sx={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Shared CPU</Typography>
                      <Chip label="Free Tier Eligible" size="small" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(16,185,129,0.12)", color: "#10b981", fontWeight: 600 }} />
                    </Box>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.5 }}>
                      Burstable microVM, cost-effective, ideal for web services and APIs.
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
                      p: 2,
                      borderRadius: 2,
                      border: machineType === "performance" ? "2px solid var(--primary)" : "1px solid var(--border)",
                      bgcolor: machineType === "performance" ? "rgba(59,130,246,0.06)" : "var(--background)",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "inherit",
                    }}
                  >
                    <Box sx={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Performance CPU</Typography>
                      <Chip label="Dedicated" size="small" sx={{ height: 18, fontSize: 10 }} />
                    </Box>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.5 }}>
                      Dedicated CPU cores without throttling for production workloads.
                    </Typography>
                  </Box>
                </Box>
              </Box>

              {/* RAM Selector */}
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, mb: 1 }}>
                  RAM Selector *
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {RAM_OPTIONS.map((opt) => {
                    const isSelected = ramMb === opt.value;
                    return (
                      <Box
                        key={opt.value}
                        component="button"
                        type="button"
                        onClick={() => setRamMb(opt.value)}
                        sx={{
                          py: 1,
                          px: 2,
                          borderRadius: 1.5,
                          border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                          bgcolor: isSelected ? "rgba(59,130,246,0.1)" : "var(--background)",
                          color: isSelected ? "var(--primary)" : "inherit",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                        }}
                      >
                        <span>{opt.label}</span>
                        {opt.isFree && machineType === "shared" && (
                          <Chip label="Free" size="small" sx={{ height: 16, fontSize: 9, bgcolor: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 700 }} />
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* CPU Selector */}
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, mb: 1 }}>
                  CPU Selector *
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {CPU_OPTIONS.map((opt) => {
                    const isSelected = cpus === opt.value;
                    return (
                      <Box
                        key={opt.value}
                        component="button"
                        type="button"
                        onClick={() => setCpus(opt.value)}
                        sx={{
                          py: 1,
                          px: 2,
                          borderRadius: 1.5,
                          border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                          bgcolor: isSelected ? "rgba(59,130,246,0.1)" : "var(--background)",
                          color: isSelected ? "var(--primary)" : "inherit",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                        }}
                      >
                        <span>{opt.label}</span>
                        {opt.isFree && machineType === "shared" && (
                          <Chip label="Free" size="small" sx={{ height: 16, fontSize: 9, bgcolor: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 700 }} />
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* Volume Selector */}
              <Box>
                <Typography sx={{ fontSize: 12.5, fontWeight: 500, mb: 1 }}>
                  Persistent Storage Volume
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {VOLUME_OPTIONS.map((opt) => {
                    const isSelected = volumeGb === opt.value;
                    return (
                      <Box
                        key={opt.value}
                        component="button"
                        type="button"
                        onClick={() => setVolumeGb(opt.value)}
                        sx={{
                          py: 1,
                          px: 2,
                          borderRadius: 1.5,
                          border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                          bgcolor: isSelected ? "rgba(59,130,246,0.1)" : "var(--background)",
                          color: isSelected ? "var(--primary)" : "inherit",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 0.75,
                        }}
                      >
                        <span>{opt.label}</span>
                        {opt.isFree && (
                          <Chip label="Free" size="small" sx={{ height: 16, fontSize: 9, bgcolor: "rgba(16,185,129,0.15)", color: "#10b981", fontWeight: 700 }} />
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* Region Selector */}
              <Box>
                <Typography component="label" htmlFor="region-select" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                  Deployment Region *
                </Typography>
                <Select
                  id="region-select"
                  size="small"
                  fullWidth
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  {FLY_REGIONS.map(({ code, name: rName }) => (
                    <MenuItem key={code} value={code}>
                      {rName} ({code.toUpperCase()})
                    </MenuItem>
                  ))}
                </Select>
              </Box>

              {/* Free Tier Notice Banner */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: 2,
                  border: isFreeTier ? "1px solid rgba(16,185,129,0.3)" : "1px solid var(--border)",
                  bgcolor: isFreeTier ? "rgba(16,185,129,0.06)" : "var(--muted)",
                  p: 2,
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                    {isFreeTier ? "Free Tier Selected: $0.00 / month" : "Standard Resource Plan"}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.25 }}>
                    {isFreeTier
                      ? "Your configuration (Shared CPU, 256 MB RAM, 2 vCPUs) is completely free under the Starter quota."
                      : `Selected: ${machineType === "shared" ? "Shared" : "Dedicated"} CPU, ${ramMb} MB RAM, ${cpus} vCPU.`}
                  </Typography>
                </Box>
                <Chip
                  label={isFreeTier ? "FREE" : "~$3.19/mo"}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    bgcolor: isFreeTier ? "rgba(16,185,129,0.15)" : "var(--primary)",
                    color: isFreeTier ? "#10b981" : "var(--primary-foreground)",
                  }}
                />
              </Box>
            </Stack>

            {/* Bottom Next Button */}
            <Box sx={{ display: "flex", justifyContent: "flex-end", pt: 1 }}>
              <Button
                type="button"
                variant="contained"
                size="large"
                onClick={() => void handleProceedToAnalysis()}
                disabled={!name.trim() || (sourceType === "github" ? !repoUrl.trim() : !dockerInputRaw.trim())}
                endIcon={<ArrowRight style={{ width: 16, height: 16 }} />}
                sx={{ px: 4, py: 1.25, fontSize: 14, fontWeight: 600 }}
              >
                {sourceType === "github" ? "Next: Analyze Repository" : "Next: Review & Deploy"}
              </Button>
            </Box>
          </Stack>
        )}

        {/* =========================================================================
            STEP 2: ANALYZE & DEPLOYABLE PATH
        ========================================================================= */}
        {step === "analyze" && (
          <Stack spacing={3.5}>
            {/* Automated Analysis Section */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Sparkles style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                    Repository Analysis &amp; Deployable Path
                  </Typography>
                </Stack>
                {isAnalyzingRepo && (
                  <Chip
                    icon={<CircularProgress size={12} color="inherit" />}
                    label="Analyzing Repo…"
                    size="small"
                    sx={{ bgcolor: "rgba(59,130,246,0.1)", color: "var(--primary)", fontSize: 11 }}
                  />
                )}
              </Box>

              {/* Scanning status */}
              {isAnalyzingRepo ? (
                <Stack
                  spacing={2}
                  sx={{
                    alignItems: "center",
                    justifyContent: "center",
                    py: 6,
                    border: "1px dashed var(--border)",
                    borderRadius: 2,
                    bgcolor: "rgba(255,255,255,0.015)",
                  }}
                >
                  <CircularProgress size={32} />
                  <Box sx={{ textAlign: "center" }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      Scanning repository &amp; detecting frameworks…
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.5 }}>
                      Detecting build tools (pnpm, npm, cargo, pip), monorepos, and deployable paths automatically.
                    </Typography>
                  </Box>
                </Stack>
              ) : (
                <Stack spacing={2.5}>
                  {discoveryError && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                        borderRadius: 1.5,
                        border: "1px solid rgba(239,68,68,0.25)",
                        bgcolor: "rgba(239,68,68,0.08)",
                        p: 1.5,
                        fontSize: 12.5,
                        color: "var(--destructive)",
                      }}
                    >
                      <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
                      <span>{discoveryError}</span>
                    </Stack>
                  )}

                  {/* Deployable Path Card */}
                  <Box
                    sx={{
                      borderRadius: 2,
                      border: "1px solid var(--border)",
                      bgcolor: "var(--background)",
                      p: 2.5,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <FolderGit2 style={{ width: 18, height: 18, color: "var(--primary)" }} />
                        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                          Detected Deployable Path:
                        </Typography>
                      </Stack>
                      <Chip
                        label={discoveryResult?.monorepo ? "Monorepo Workspace" : "Single Service"}
                        size="small"
                        sx={{ fontSize: 11, fontWeight: 600 }}
                      />
                    </Box>

                    {/* Candidate Projects or Default Root */}
                    {discoveryResult?.candidates && discoveryResult.candidates.length > 0 ? (
                      <Stack spacing={1.5} sx={{ mb: 2 }}>
                        {discoveryResult.candidates.map((cand) => {
                          const isSelected = selectedCandidateId === cand.id;
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
                                gap: 1,
                                p: 1.75,
                                borderRadius: 1.5,
                                border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                                bgcolor: isSelected ? "rgba(59,130,246,0.06)" : "var(--card)",
                                cursor: "pointer",
                                textAlign: "left",
                                color: "inherit",
                              }}
                            >
                              <Box sx={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
                                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                  <CheckCircle2 style={{ width: 16, height: 16, color: isSelected ? "var(--primary)" : "var(--muted-foreground)" }} />
                                  <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>{cand.name}</Typography>
                                </Stack>
                                <Box
                                  component="code"
                                  sx={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: 12,
                                    bgcolor: "var(--muted)",
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: 1,
                                  }}
                                >
                                  {cand.rootDirectory === "." ? "root (/)" : cand.rootDirectory}
                                </Box>
                              </Box>

                              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", pl: 3 }}>
                                {cand.frameworkName && (
                                  <Chip label={cand.frameworkName} size="small" sx={{ height: 20, fontSize: 10, bgcolor: "rgba(59,130,246,0.15)", color: "var(--primary)", fontWeight: 600 }} />
                                )}
                                {cand.language && (
                                  <Chip label={cand.language.toUpperCase()} size="small" sx={{ height: 20, fontSize: 10 }} />
                                )}
                                {cand.packageManager && (
                                  <Chip label={cand.packageManager} size="small" sx={{ height: 20, fontSize: 10 }} />
                                )}
                                {cand.dockerfilePath && (
                                  <Chip label="Dockerfile" size="small" sx={{ height: 20, fontSize: 10, bgcolor: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 600 }} />
                                )}
                              </Stack>
                            </Box>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Box sx={{ mb: 2, p: 2, borderRadius: 1.5, bgcolor: "var(--card)", border: "1px solid var(--border)" }}>
                        <Typography sx={{ fontSize: 13 }}>
                          Root service detected at <Box component="code" sx={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>./</Box> (Railpack automated build).
                        </Typography>
                      </Box>
                    )}

                    {/* Root directory override */}
                    <Box sx={{ pt: 1.5, borderTop: "1px solid var(--border)" }}>
                      <Typography component="label" htmlFor="custom-root-dir" sx={{ display: "block", fontSize: 12, fontWeight: 500, mb: 0.75 }}>
                        Deployable Root Directory (relative to repository root):
                      </Typography>
                      <TextField
                        id="custom-root-dir"
                        size="small"
                        fullWidth
                        placeholder="."
                        value={customRootDirectory}
                        onChange={(e) => setCustomRootDirectory(e.target.value)}
                        slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                      />
                    </Box>
                  </Box>
                </Stack>
              )}
            </Stack>

            {/* Deployment Review Summary Card */}
            <Stack spacing={2} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Deployment Configuration Review</Typography>
                <Chip
                  label={isFreeTier ? "Free Tier Eligible" : "Standard"}
                  size="small"
                  sx={{
                    bgcolor: isFreeTier ? "rgba(16,185,129,0.15)" : "var(--muted)",
                    color: isFreeTier ? "#10b981" : "inherit",
                    fontWeight: 600,
                  }}
                />
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, fontSize: 13 }}>
                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>App Name</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{name}</Typography>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Target URL</Typography>
                  <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--primary)" }}>
                    https://{name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-[id].fly.dev
                  </Typography>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Source</Typography>
                  <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {sourceType === "github" ? repoUrl : dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw}
                  </Typography>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Deployable Path</Typography>
                  <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>
                    {sourceType === "github" ? customRootDirectory || "." : "Container Root"}
                  </Typography>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Hardware Specs</Typography>
                  <Typography sx={{ fontWeight: 500 }}>
                    {machineType === "shared" ? "Shared" : "Performance"} · {cpus} vCPU · {ramMb} MB RAM · {volumeGb > 0 ? `${volumeGb} GB Disk` : "Ephemeral Disk"}
                  </Typography>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Region</Typography>
                  <Typography sx={{ fontWeight: 500 }}>
                    {selectedRegionName} ({region.toUpperCase()})
                  </Typography>
                </Box>
              </Box>

              <Divider />

              {/* Action Buttons: Back + Deploy */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", pt: 1 }}>
                <Button
                  type="button"
                  variant="outlined"
                  size="small"
                  onClick={() => setStep("configure")}
                  disabled={deployMutation.isPending}
                  startIcon={<ArrowLeft style={{ width: 14, height: 14 }} />}
                >
                  Back to Configuration
                </Button>

                <Button
                  type="button"
                  variant="contained"
                  size="large"
                  onClick={() => deployMutation.mutate()}
                  disabled={deployMutation.isPending || isAnalyzingRepo}
                  startIcon={
                    deployMutation.isPending ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <Rocket style={{ width: 16, height: 16 }} />
                    )
                  }
                  sx={{ px: 4, py: 1.25, fontWeight: 700 }}
                >
                  {deployMutation.isPending ? "Deploying Application…" : "Deploy Application"}
                </Button>
              </Box>
            </Stack>
          </Stack>
        )}

        {/* =========================================================================
            STEP 3: DEPLOYMENT & LIVE LOGS
        ========================================================================= */}
        {step === "deploying" && (
          <Stack spacing={3}>
            {/* Live Deployment Header Card */}
            <Stack spacing={2} sx={cardSx}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
                <Box>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Server style={{ width: 18, height: 18, color: "var(--primary)" }} />
                    <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{name}</Typography>
                    <Chip label="Live Deployment" size="small" sx={{ bgcolor: "rgba(59,130,246,0.15)", color: "var(--primary)", fontWeight: 600 }} />
                  </Stack>
                  <Typography sx={{ fontSize: 12.5, color: "var(--muted-foreground)", mt: 0.5 }}>
                    {sourceType === "github" ? repoUrl : dockerInputRaw} · {selectedRegionName} ({region.toUpperCase()})
                  </Typography>
                </Box>

                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {activeDeploymentId && (
                    <Button
                      component={Link}
                      href={`/deployments/${activeDeploymentId}`}
                      variant="outlined"
                      size="small"
                      endIcon={<ExternalLink style={{ width: 12, height: 12 }} />}
                    >
                      Deployment Details
                    </Button>
                  )}
                  {activeAppId && (
                    <Button
                      component={Link}
                      href={`/apps/${activeAppId}`}
                      variant="contained"
                      size="small"
                      endIcon={<ExternalLink style={{ width: 12, height: 12 }} />}
                    >
                      Open App Page
                    </Button>
                  )}
                  <Button
                    component={Link}
                    href="/apps"
                    variant="outlined"
                    size="small"
                  >
                    Go to Apps
                  </Button>
                </Stack>
              </Box>

              {activePublicUrl && (
                <Box sx={{ pt: 1, borderTop: "1px solid var(--border)" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mb: 0.5 }}>
                    Public Application URL:
                  </Typography>
                  <CopyField value={activePublicUrl} />
                </Box>
              )}
            </Stack>

            {/* Live Logs Viewer */}
            {activeDeploymentId ? (
              <DeploymentLogsViewer
                deploymentId={activeDeploymentId}
                initialStatus="building"
                buildNumber={1}
              />
            ) : (
              <Stack
                spacing={2}
                sx={{
                  alignItems: "center",
                  justifyContent: "center",
                  p: 6,
                  borderRadius: 2.5,
                  border: "1px solid var(--border)",
                  bgcolor: "var(--card)",
                }}
              >
                <CircularProgress size={32} />
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                  Provisioning container machine…
                </Typography>
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Allocating Anycast IPv4, configuring ports, and launching microVM in {selectedRegionName}.
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>

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
