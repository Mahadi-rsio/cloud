"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Box as BoxIcon,
  Check,
  CheckCircle2,
  Cpu,
  FolderGit2,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Plus,
  Rocket,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListSubheader from "@mui/material/ListSubheader";
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
import {
  DEFAULT_PRESET_ID,
  FLY_MACHINE_PRESETS,
  STARTER_TEMPLATES,
  findPresetById,
  type FlyMachinePreset,
  type StarterTemplate,
} from "./machine-presets";

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg role="img" viewBox="0 0 24 24" fill="currentColor" width={size} height={size}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

type EnvPair = { id: string; key: string; value: string };

const cardSx = {
  borderRadius: 2.5,
  border: "1px solid var(--border)",
  bgcolor: "var(--card)",
  p: 3,
} as const;

const cardHeaderSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1.5,
  pb: 1.5,
  borderBottom: "1px solid var(--border)",
} as const;

function CreateApplicationContent() {
  const router = useRouter();

  const [sourceType, setSourceType] = useState<"github" | "docker">("github");
  const [name, setName] = useState("");
  const [region, setRegion] = useState("sin");

  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [isValidatingRepo, setIsValidatingRepo] = useState(false);
  const [repoPreview, setRepoPreview] = useState<ValidatedRepository | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  const [isAnalyzingRepo, setIsAnalyzingRepo] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveredRepositoryResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [customRootDirectory, setCustomRootDirectory] = useState<string>(".");
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [discoverySha, setDiscoverySha] = useState<string | null>(null);

  const [dockerInputRaw, setDockerInputRaw] = useState("");
  const [dockerParsed, setDockerParsed] = useState<ParsedDockerImage | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [customCpus, setCustomCpus] = useState("1");
  const [customMemory, setCustomMemory] = useState("256");
  const [internalPort, setInternalPort] = useState("");

  const [envMode, setEnvMode] = useState<"pairs" | "json">("pairs");
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([
    { id: "1", key: "NODE_ENV", value: "production" },
  ]);
  const [envJson, setEnvJson] = useState('{\n  "NODE_ENV": "production"\n}');
  const [error, setError] = useState<string | null>(null);

  const activePreset: FlyMachinePreset | undefined =
    presetId !== "custom" ? findPresetById(presetId) : undefined;

  const handleDockerInputChange = (val: string) => {
    setDockerInputRaw(val);
    setSelectedTemplate(null);
    if (!val.trim()) {
      setDockerParsed(null);
      return;
    }
    setDockerParsed(parseDockerInput(val));
  };

  const handleApplyTemplate = (tpl: StarterTemplate) => {
    setSelectedTemplate(tpl.name);
    setDockerInputRaw(tpl.image);
    setDockerParsed(parseDockerInput(tpl.image));
    setInternalPort(String(tpl.port));
    if (tpl.env) {
      const pairs = Object.entries(tpl.env).map(([key, value], idx) => ({
        id: String(idx + 1),
        key,
        value,
      }));
      setEnvPairs(pairs);
      setEnvJson(JSON.stringify(tpl.env, null, 2));
    }
  };

  const handleValidateGitHub = async (urlToCheck?: string) => {
    const targetUrl = (urlToCheck ?? repoUrl).trim();
    if (!targetUrl) {
      setRepoPreview(null);
      setRepoError(null);
      setDiscoveryResult(null);
      setDiscoveryError(null);
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

  const handleAnalyzeRepo = async () => {
    const targetUrl = repoUrl.trim();
    if (!targetUrl) return;

    setIsAnalyzingRepo(true);
    setDiscoveryError(null);
    try {
      let branchToUse = repoBranch.trim();
      if (!repoPreview) {
        const check = await validateDeployment({ url: targetUrl });
        if (check.valid) {
          setRepoPreview(check.repository);
          if (!branchToUse) {
            branchToUse = check.repository.defaultBranch;
            setRepoBranch(branchToUse);
          }
          if (!name.trim()) {
            setName(check.repository.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
          }
        }
      }
      if (!branchToUse) {
        branchToUse = repoPreview?.defaultBranch || "main";
      }

      const res = await discoverRepository({ url: targetUrl, branch: branchToUse });
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
    } finally {
      setIsAnalyzingRepo(false);
    }
  };

  const handleAddEnvPair = () => {
    const newId = String(Date.now());
    setEnvPairs([...envPairs, { id: newId, key: "", value: "" }]);
  };

  const handleUpdateEnvPair = (id: string, field: "key" | "value", val: string) => {
    const updated = envPairs.map((p) => (p.id === id ? { ...p, [field]: val } : p));
    setEnvPairs(updated);
    const obj: Record<string, string> = {};
    for (const p of updated) {
      if (p.key.trim()) obj[p.key.trim()] = p.value;
    }
    setEnvJson(JSON.stringify(obj, null, 2));
  };

  const handleRemoveEnvPair = (id: string) => {
    const filtered = envPairs.filter((p) => p.id !== id);
    setEnvPairs(filtered);
    const obj: Record<string, string> = {};
    for (const p of filtered) {
      if (p.key.trim()) obj[p.key.trim()] = p.value;
    }
    setEnvJson(JSON.stringify(obj, null, 2));
  };

  const deployMutation = useMutation({
    mutationFn: async () => {
      let parsedEnv: Record<string, string> | undefined;
      if (envMode === "json") {
        if (envJson.trim()) {
          try {
            parsedEnv = JSON.parse(envJson);
          } catch {
            throw new Error("Invalid JSON in environment variables.");
          }
        }
      } else {
        const obj: Record<string, string> = {};
        for (const pair of envPairs) {
          if (pair.key.trim()) {
            obj[pair.key.trim()] = pair.value;
          }
        }
        if (Object.keys(obj).length > 0) {
          parsedEnv = obj;
        }
      }

      if (sourceType === "github") {
        const trimmedUrl = repoUrl.trim();
        if (!trimmedUrl) {
          throw new Error("Please enter a GitHub repository URL.");
        }
        const selectedCandidate = discoveryResult?.candidates.find(
          (c) => c.id === selectedCandidateId,
        );
        const finalRoot = customRootDirectory.trim() || selectedCandidate?.rootDirectory || ".";

        const deployment = await createDeployment({
          url: trimmedUrl,
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

      let cpus = 1;
      let memoryMb = 256;
      let cpuKind: "shared" | "performance" = "shared";

      if (presetId === "custom") {
        cpus = Number(customCpus) || 1;
        memoryMb = Number(customMemory) || 256;
      } else if (activePreset) {
        cpus = activePreset.cpus;
        memoryMb = activePreset.memoryMb;
        cpuKind = activePreset.cpuKind;
      }

      const runtimePayload = {
        image: finalImage,
        guest: {
          cpu_kind: cpuKind,
          cpus,
          memory_mb: memoryMb,
        },
        ...(internalPort.trim() ? { internalPort: Number(internalPort) } : {}),
        ...(parsedEnv ? { env: parsedEnv } : {}),
      };

      const input = createApplicationSchema.parse({
        name: name.trim(),
        region,
        runtime: runtimePayload,
      });

      const res = await createApplication(input);
      return { type: "docker" as const, appId: res.application.id };
    },
    onSuccess: (result) => {
      if (result.type === "github") {
        router.push(`/deployments/${result.deploymentId}`);
      } else {
        router.push(`/apps/${result.appId}`);
      }
    },
    onError: (err) => {
      setError(extractErrorMessage(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    deployMutation.mutate();
  };

  const selectedRegionName = FLY_REGIONS.find((r) => r.code === region)?.name || region;
  const isFormValid =
    name.trim().length >= 2 && (sourceType === "github" ? repoUrl.trim().length > 0 : true);

  return (
    <Box sx={{ mx: "auto", width: "100%", maxWidth: 1024, pb: 8 }}>
      <Stack spacing={4}>
        <Box>
          <Button
            component={Link}
            href="/apps"
            variant="text"
            size="small"
            startIcon={<ArrowLeft style={{ width: 16, height: 16 }} />}
            sx={{ ml: -1, color: "var(--muted-foreground)", mb: 1.5 }}
          >
            Back to Apps
          </Button>
          <Box sx={{ borderBottom: "1px solid var(--border)", pb: 3 }}>
            <Typography variant="h1" sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Create &amp; Deploy App
            </Typography>
            <Typography sx={{ fontSize: 13.5, color: "var(--muted-foreground)", mt: 0.75 }}>
              Deploy your service from a public GitHub repository with automatic builds, or directly from any Docker container image.
            </Typography>
          </Box>
        </Box>

        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" },
            gap: 4,
            alignItems: "start",
          }}
        >
          {/* Left Column */}
          <Stack spacing={4}>
            {/* Section 1: Application Details */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Server style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Application Details</Typography>
                </Stack>
              </Box>

              <Box>
                <Typography component="label" htmlFor="app-name" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                  Application Name *
                </Typography>
                <TextField
                  id="app-name"
                  name="name"
                  size="small"
                  fullWidth
                  autoComplete="off"
                  placeholder="my-cool-app"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                  A unique identifier for your app. Your app will receive a secure URL:{" "}
                  <Box component="span" sx={{ fontFamily: "var(--font-mono)", fontWeight: 500, color: "var(--foreground)" }}>
                    https://{name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "my-cool-app"}-[id].fly.dev
                  </Box>
                </Typography>
              </Box>

              <Box>
                <Typography component="label" htmlFor="app-region" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                  Primary Region
                </Typography>
                <Select
                  id="app-region"
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
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                  Deploy close to your users or database to minimize latency.
                </Typography>
              </Box>
            </Stack>

            {/* Section 2: Deployment Source */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Layers style={{ width: 16, height: 16, color: "var(--primary)" }} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Deployment Source</Typography>
                </Stack>
                <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  Select how your code is packaged
                </Typography>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setSourceType("github")}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 0.75,
                    borderRadius: 2,
                    border: sourceType === "github" ? "1px solid var(--primary)" : "1px solid var(--border)",
                    bgcolor: sourceType === "github" ? "rgba(59,130,246,0.06)" : "var(--background)",
                    p: 2,
                    textAlign: "left",
                    cursor: "pointer",
                    color: "inherit",
                    "&:hover": { bgcolor: sourceType === "github" ? "rgba(59,130,246,0.08)" : "var(--muted)" },
                  }}
                >
                  <Box sx={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <GitHubIcon size={18} />
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>GitHub Repository</Typography>
                    </Stack>
                    {sourceType === "github" && <CheckCircle2 style={{ width: 16, height: 16, color: "var(--primary)" }} />}
                  </Box>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                    Build automatically from source code using Railpack or Dockerfile.
                  </Typography>
                </Box>

                <Box
                  component="button"
                  type="button"
                  onClick={() => setSourceType("docker")}
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 0.75,
                    borderRadius: 2,
                    border: sourceType === "docker" ? "1px solid var(--primary)" : "1px solid var(--border)",
                    bgcolor: sourceType === "docker" ? "rgba(59,130,246,0.06)" : "var(--background)",
                    p: 2,
                    textAlign: "left",
                    cursor: "pointer",
                    color: "inherit",
                    "&:hover": { bgcolor: sourceType === "docker" ? "rgba(59,130,246,0.08)" : "var(--muted)" },
                  }}
                >
                  <Box sx={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <BoxIcon style={{ width: 18, height: 18 }} />
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>Docker Container</Typography>
                    </Stack>
                    {sourceType === "docker" && <CheckCircle2 style={{ width: 16, height: 16, color: "var(--primary)" }} />}
                  </Box>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                    Deploy pre-built image from Docker Hub, GHCR, Quay, or any registry.
                  </Typography>
                </Box>
              </Box>

              {sourceType === "github" ? (
                <Stack spacing={2.5} sx={{ pt: 0.5 }}>
                  <Box>
                    <Typography component="label" htmlFor="repo-url" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Public GitHub Repository URL *
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <TextField
                        id="repo-url"
                        type="url"
                        size="small"
                        fullWidth
                        placeholder="https://github.com/username/my-project"
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
                        {isValidatingRepo ? "Checking…" : "Verify"}
                      </Button>
                    </Stack>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                      Any public GitHub repository. Railpack detects Next.js, Node.js, Python, Go, Rust, Ruby, PHP, and SvelteKit automatically.
                    </Typography>
                  </Box>

                  {repoError && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", 
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
                    <Stack
                      spacing={1.5}
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
                        <Box
                          component="span"
                          sx={{
                            borderRadius: 1,
                            bgcolor: "rgba(16,185,129,0.12)",
                            px: 1,
                            py: 0.25,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#10b981",
                            textTransform: "uppercase",
                          }}
                        >
                          Verified
                        </Box>
                      </Box>

                      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr" }, gap: 1.5, fontSize: 12 }}>
                        <Box>
                          <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Default Branch:</Typography>
                          <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 500 }}>
                            {repoPreview.defaultBranch}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Repository Type:</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>
                            {repoPreview.fork ? "Fork" : "Original"}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Detection:</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: "#10b981" }}>
                            Ready to build
                          </Typography>
                        </Box>
                      </Box>
                    </Stack>
                  )}

                  <Box>
                    <Typography component="label" htmlFor="repo-branch" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Branch (optional)
                    </Typography>
                    <TextField
                      id="repo-branch"
                      size="small"
                      fullWidth
                      placeholder={repoPreview?.defaultBranch || "main"}
                      value={repoBranch}
                      onChange={(e) => setRepoBranch(e.target.value)}
                      slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                    />
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                      Leave blank to deploy the repository&apos;s default branch ({repoPreview?.defaultBranch || "main"}).
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                    <Button
                      type="button"
                      variant={discoveryResult ? "outlined" : "contained"}
                      size="small"
                      onClick={() => void handleAnalyzeRepo()}
                      disabled={isAnalyzingRepo || !repoUrl.trim()}
                      startIcon={<Sparkles style={{ width: 14, height: 14 }} />}
                    >
                      {isAnalyzingRepo ? "Analyzing Repository…" : "Analyze Repository"}
                    </Button>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                      {discoveryResult
                        ? `Discovered ${discoveryResult.candidates.length} application${discoveryResult.candidates.length === 1 ? "" : "s"}`
                        : "Automatically scans frameworks, monorepos, and deployable paths"}
                    </Typography>
                  </Stack>

                  {discoveryError && (
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "center", 
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

                  {discoveryResult && (
                    <Stack
                      spacing={2}
                      sx={{
                        borderRadius: 2,
                        border: "1px solid rgba(59,130,246,0.25)",
                        bgcolor: "rgba(59,130,246,0.05)",
                        p: 2,
                      }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                          <FolderGit2 style={{ width: 16, height: 16, color: "var(--primary)" }} />
                          <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                            Detected Applications ({discoveryResult.candidates.length})
                          </Typography>
                        </Stack>
                        {discoveryResult.monorepo && (
                          <Box
                            component="span"
                            sx={{
                              borderRadius: 99,
                              bgcolor: "rgba(59,130,246,0.12)",
                              px: 1.25,
                              py: 0.25,
                              fontSize: 11,
                              fontWeight: 500,
                              color: "var(--primary)",
                            }}
                          >
                            Monorepo Workspace
                          </Box>
                        )}
                      </Box>

                      {discoveryResult.candidates.length === 0 ? (
                        <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                          No standard application framework detected. Railpack will attempt automated zero-config build at root.
                        </Typography>
                      ) : (
                        <Stack spacing={1.25}>
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
                                  if (!name.trim() && cand.name) {
                                    setName(cand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                                  }
                                }}
                                sx={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 1,
                                  borderRadius: 1.5,
                                  border: isSelected ? "1px solid var(--primary)" : "1px solid var(--border)",
                                  bgcolor: isSelected ? "var(--background)" : "rgba(255,255,255,0.02)",
                                  p: 1.5,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  color: "inherit",
                                }}
                              >
                                <Box sx={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                    <Box
                                      sx={{
                                        width: 16,
                                        height: 16,
                                        borderRadius: "50%",
                                        border: isSelected ? "1px solid var(--primary)" : "1px solid var(--muted-foreground)",
                                        bgcolor: isSelected ? "var(--primary)" : "transparent",
                                        color: "var(--primary-foreground)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      {isSelected && <Check style={{ width: 10, height: 10 }} />}
                                    </Box>
                                    <Typography sx={{ fontSize: 13.5, fontWeight: 500 }}>{cand.name}</Typography>
                                  </Stack>
                                  <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>
                                    {cand.rootDirectory === "." ? "root (/)" : cand.rootDirectory}
                                  </Typography>
                                </Box>

                                <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap",  pl: 3 }}>
                                  {cand.frameworkName && (
                                    <Box component="span" sx={{ borderRadius: 1, bgcolor: "rgba(59,130,246,0.12)", px: 1, py: 0.25, fontSize: 11, fontWeight: 500, color: "var(--primary)" }}>
                                      {cand.frameworkName}
                                    </Box>
                                  )}
                                  {cand.language && (
                                    <Box component="span" sx={{ borderRadius: 1, bgcolor: "var(--muted)", px: 1, py: 0.25, fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)", textTransform: "uppercase" }}>
                                      {cand.language}
                                    </Box>
                                  )}
                                  {cand.runtime && (
                                    <Box component="span" sx={{ borderRadius: 1, bgcolor: "var(--muted)", px: 1, py: 0.25, fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)" }}>
                                      {cand.runtime}
                                    </Box>
                                  )}
                                  {cand.packageManager && (
                                    <Box component="span" sx={{ borderRadius: 1, bgcolor: "var(--muted)", px: 1, py: 0.25, fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)" }}>
                                      {cand.packageManager}
                                    </Box>
                                  )}
                                  {cand.dockerfilePath && (
                                    <Box component="span" sx={{ borderRadius: 1, bgcolor: "rgba(245,158,11,0.12)", px: 1, py: 0.25, fontSize: 11, fontWeight: 500, color: "#f59e0b" }}>
                                      Dockerfile
                                    </Box>
                                  )}
                                </Stack>
                              </Box>
                            );
                          })}
                        </Stack>
                      )}

                      <Box sx={{ pt: 1, borderTop: "1px solid var(--border)" }}>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
                          <Typography component="label" htmlFor="root-directory" sx={{ fontSize: 12, fontWeight: 500 }}>
                            Application Root Directory
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            Relative to repository root
                          </Typography>
                        </Box>
                        <TextField
                          id="root-directory"
                          size="small"
                          fullWidth
                          placeholder="."
                          value={customRootDirectory}
                          onChange={(e) => setCustomRootDirectory(e.target.value)}
                          slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                        />
                      </Box>
                    </Stack>
                  )}

                  <Stack
                    spacing={1.5}
                    sx={{ alignItems: "center", 
                      borderRadius: 2,
                      border: "1px dashed var(--border)",
                      bgcolor: "rgba(255,255,255,0.015)",
                      p: 2.5,
                      textAlign: "center",
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        bgcolor: "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <GitHubIcon size={20} />
                    </Box>
                    <Box sx={{ maxWidth: 380 }}>
                      <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                        Deploy your private &amp; organization repositories
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.5 }}>
                        Connect your GitHub account to browse and pick repositories directly without copying URLs.
                      </Typography>
                    </Box>
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      startIcon={<GitHubIcon size={14} />}
                      onClick={() => {
                        alert(
                          "GitHub OAuth account connection is coming soon. You can deploy any public GitHub repository right now by entering the URL above!",
                        );
                      }}
                    >
                      Connect GitHub
                    </Button>
                  </Stack>
                </Stack>
              ) : (
                <Stack spacing={2.5} sx={{ pt: 0.5 }}>
                  <Box>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mb: 1 }}>
                      Quick start with common templates (optional):
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
                    <Typography component="label" htmlFor="docker-pull-cmd" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Docker Image or Pull Command
                    </Typography>
                    <TextField
                      id="docker-pull-cmd"
                      size="small"
                      fullWidth
                      placeholder="docker pull ghcr.io/username/repo:latest or nginx:alpine"
                      value={dockerInputRaw}
                      onChange={(e) => handleDockerInputChange(e.target.value)}
                      slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 13 } } }}
                    />
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                      Paste an image name or full pull command (e.g.{" "}
                      <Box component="code" sx={{ fontFamily: "var(--font-mono)" }}>
                        docker pull ghcr.io/owner/app:v1
                      </Box>
                      ). The registry is detected automatically.
                    </Typography>
                  </Box>

                  {dockerParsed && (
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 2,
                        borderRadius: 2,
                        border: "1px solid var(--border)",
                        bgcolor: "var(--muted)",
                        p: 1.75,
                      }}
                    >
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                        <Box
                          sx={{
                            width: 32,
                            height: 32,
                            borderRadius: 1.5,
                            bgcolor: "rgba(59,130,246,0.12)",
                            color: "var(--primary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <BoxIcon style={{ width: 16, height: 16 }} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Detected Registry:</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{dockerParsed.registryLabel}</Typography>
                        </Box>
                      </Stack>
                      <Box sx={{ textAlign: "right" }}>
                        <Typography sx={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Resolved Image:</Typography>
                        <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 500 }}>
                          {dockerParsed.cleanedImage}
                        </Typography>
                      </Box>
                    </Box>
                  )}

                  <Box>
                    <Typography component="label" htmlFor="app-port" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                      Container Internal Port (optional)
                    </Typography>
                    <TextField
                      id="app-port"
                      type="number"
                      size="small"
                      fullWidth
                      placeholder="Auto-detected (e.g. 80, 3000, 8080)"
                      value={internalPort}
                      onChange={(e) => setInternalPort(e.target.value)}
                      slotProps={{ htmlInput: { min: 1, max: 65535 } }}
                    />
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                      Leave blank to use intelligent automatic port detection after deploy, or specify an exact port.
                    </Typography>
                  </Box>
                </Stack>
              )}
            </Stack>

            {/* Section 3: Hardware Sizing (Docker) */}
            {sourceType === "docker" && (
              <Stack spacing={2.5} sx={cardSx}>
                <Box sx={cardHeaderSx}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Cpu style={{ width: 16, height: 16, color: "var(--primary)" }} />
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Hardware Sizing</Typography>
                  </Stack>
                  {activePreset?.tierBadge && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ alignItems: "center", 
                        borderRadius: 99,
                        bgcolor: "rgba(59,130,246,0.12)",
                        color: "var(--primary)",
                        px: 1.25,
                        py: 0.25,
                        fontSize: 11.5,
                        fontWeight: 600,
                      }}
                    >
                      <Sparkles style={{ width: 12, height: 12 }} />
                      <span>{activePreset.tierBadge}</span>
                    </Stack>
                  )}
                </Box>

                <Box>
                  <Typography component="label" htmlFor="machine-preset" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                    Select Machine Preset
                  </Typography>
                  <Select
                    id="machine-preset"
                    size="small"
                    fullWidth
                    value={presetId}
                    onChange={(e) => setPresetId(e.target.value)}
                  >
                    <ListSubheader>Shared CPU (Cost Efficient / General Workloads)</ListSubheader>
                    {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "shared").map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.label}
                      </MenuItem>
                    ))}
                    <ListSubheader>Performance CPU (Dedicated Cores / Production)</ListSubheader>
                    {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "performance").map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.label}
                      </MenuItem>
                    ))}
                    <MenuItem value="custom">Custom specifications…</MenuItem>
                  </Select>
                </Box>

                {activePreset && (
                  <Stack spacing={1.5} sx={{ borderRadius: 2, border: "1px solid var(--border)", bgcolor: "var(--muted)", p: 2 }}>
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(3, 1fr)" }, gap: 1.5 }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center",  borderRadius: 1.5, bgcolor: "var(--background)", border: "1px solid var(--border)", p: 1.25 }}>
                        <Cpu style={{ width: 16, height: 16, color: "var(--primary)", flexShrink: 0 }} />
                        <Box>
                          <Typography sx={{ fontSize: 11, color: "var(--muted-foreground)" }}>vCPU</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                            {activePreset.cpus} {activePreset.cpuKind === "shared" ? "Shared" : "Dedicated"}
                          </Typography>
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center",  borderRadius: 1.5, bgcolor: "var(--background)", border: "1px solid var(--border)", p: 1.25 }}>
                        <HardDrive style={{ width: 16, height: 16, color: "var(--primary)", flexShrink: 0 }} />
                        <Box>
                          <Typography sx={{ fontSize: 11, color: "var(--muted-foreground)" }}>RAM</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                            {activePreset.memoryMb >= 1024 ? `${activePreset.memoryMb / 1024} GB` : `${activePreset.memoryMb} MB`}
                          </Typography>
                        </Box>
                      </Stack>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center", 
                          borderRadius: 1.5,
                          bgcolor: "var(--background)",
                          border: "1px solid var(--border)",
                          p: 1.25,
                          gridColumn: { xs: "span 2", sm: "span 1" },
                        }}
                      >
                        <Globe style={{ width: 16, height: 16, color: "var(--primary)", flexShrink: 0 }} />
                        <Box>
                          <Typography sx={{ fontSize: 11, color: "var(--muted-foreground)" }}>Estimated Cost</Typography>
                          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                            {activePreset.monthlyEstimate || "Free tier"}
                          </Typography>
                        </Box>
                      </Stack>
                    </Box>
                    <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>{activePreset.description}</Typography>
                  </Stack>
                )}

                {presetId === "custom" && (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 2,
                      borderRadius: 2,
                      border: "1px dashed var(--border)",
                      p: 2,
                    }}
                  >
                    <Box>
                      <Typography component="label" htmlFor="custom-cpus" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                        vCPUs
                      </Typography>
                      <TextField
                        id="custom-cpus"
                        type="number"
                        size="small"
                        fullWidth
                        value={customCpus}
                        onChange={(e) => setCustomCpus(e.target.value)}
                        slotProps={{ htmlInput: { min: 1, max: 16 } }}
                      />
                    </Box>
                    <Box>
                      <Typography component="label" htmlFor="custom-memory" sx={{ display: "block", fontSize: 12.5, fontWeight: 500, mb: 0.75 }}>
                        Memory (MB)
                      </Typography>
                      <TextField
                        id="custom-memory"
                        type="number"
                        size="small"
                        fullWidth
                        value={customMemory}
                        onChange={(e) => setCustomMemory(e.target.value)}
                        slotProps={{ htmlInput: { min: 256, max: 32768, step: 256 } }}
                      />
                    </Box>
                  </Box>
                )}
              </Stack>
            )}

            {/* Section 4: Environment Variables */}
            <Stack spacing={2.5} sx={cardSx}>
              <Box sx={cardHeaderSx}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Environment Variables</Typography>
                <Stack direction="row" spacing={0.5} sx={{ borderRadius: 1.5, border: "1px solid var(--border)", bgcolor: "var(--muted)", p: 0.5 }}>
                  <Button
                    type="button"
                    size="small"
                    variant={envMode === "pairs" ? "contained" : "text"}
                    onClick={() => setEnvMode("pairs")}
                    sx={{ minHeight: 26, py: 0.25, px: 1.25, fontSize: 12 }}
                  >
                    Key-Value
                  </Button>
                  <Button
                    type="button"
                    size="small"
                    variant={envMode === "json" ? "contained" : "text"}
                    onClick={() => setEnvMode("json")}
                    sx={{ minHeight: 26, py: 0.25, px: 1.25, fontSize: 12 }}
                  >
                    Raw JSON
                  </Button>
                </Stack>
              </Box>

              {envMode === "pairs" ? (
                <Stack spacing={1.5}>
                  {envPairs.map((pair) => (
                    <Stack key={pair.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="KEY (e.g. DATABASE_URL)"
                        value={pair.key}
                        onChange={(e) => handleUpdateEnvPair(pair.id, "key", e.target.value)}
                        slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5, textTransform: "uppercase" } } }}
                      />
                      <TextField
                        size="small"
                        fullWidth
                        placeholder="Value"
                        value={pair.value}
                        onChange={(e) => handleUpdateEnvPair(pair.id, "value", e.target.value)}
                        slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                      />
                      <IconButton
                        type="button"
                        size="small"
                        onClick={() => handleRemoveEnvPair(pair.id)}
                        aria-label="Remove variable"
                        sx={{ color: "var(--muted-foreground)", "&:hover": { color: "var(--destructive)" } }}
                      >
                        <Trash2 style={{ width: 16, height: 16 }} />
                      </IconButton>
                    </Stack>
                  ))}
                  <Box>
                    <Button
                      type="button"
                      variant="outlined"
                      size="small"
                      onClick={handleAddEnvPair}
                      startIcon={<Plus style={{ width: 14, height: 14 }} />}
                      sx={{ fontSize: 12 }}
                    >
                      Add Variable
                    </Button>
                  </Box>
                </Stack>
              ) : (
                <Box>
                  <TextField
                    multiline
                    rows={5}
                    fullWidth
                    value={envJson}
                    onChange={(e) => setEnvJson(e.target.value)}
                    placeholder={'{\n  "KEY": "value"\n}'}
                    slotProps={{ htmlInput: { sx: { fontFamily: "var(--font-mono)", fontSize: 12.5 } } }}
                  />
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)", mt: 0.75 }}>
                    Provide a valid JSON key-value object of strings.
                  </Typography>
                </Box>
              )}
            </Stack>
          </Stack>

          {/* Right Column: Summary */}
          <Stack spacing={3} sx={{ position: { lg: "sticky" }, top: { lg: 24 } }}>
            <Stack spacing={2.5} sx={cardSx}>
              <Typography sx={{ fontSize: 14, fontWeight: 600, pb: 1.5, borderBottom: "1px solid var(--border)" }}>
                Deploy Summary
              </Typography>

              <Stack spacing={1.5} sx={{ fontSize: 12.5 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>App Name:</Typography>
                  <Typography noWrap sx={{ fontSize: 12, fontWeight: 500, maxWidth: 160 }}>
                    {name || "(not specified)"}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Source Type:</Typography>
                  <Box
                    component="span"
                    sx={{
                      borderRadius: 1,
                      bgcolor: "var(--muted)",
                      px: 1,
                      py: 0.25,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    {sourceType === "github" ? "GitHub Repository" : "Docker Container"}
                  </Box>
                </Box>

                {sourceType === "github" ? (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Repository:</Typography>
                      <Typography noWrap sx={{ fontFamily: "var(--font-mono)", fontSize: 12, maxWidth: 160 }}>
                        {repoPreview ? `${repoPreview.owner}/${repoPreview.name}` : repoUrl || "(not entered)"}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Branch:</Typography>
                      <Typography sx={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {repoBranch || repoPreview?.defaultBranch || "main"}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Build Engine:</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 500, color: "var(--primary)" }}>
                        Railpack / BuildKit
                      </Typography>
                    </Box>
                  </>
                ) : (
                  <>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Container Image:</Typography>
                      <Typography noWrap sx={{ fontFamily: "var(--font-mono)", fontSize: 12, maxWidth: 160 }}>
                        {dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw || "nginx:alpine (default)"}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Registry:</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 500 }}>
                        {dockerParsed ? dockerParsed.registryLabel : "Docker Hub"}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Machine Sizing:</Typography>
                      <Typography sx={{ fontSize: 12, fontWeight: 500 }}>
                        {activePreset ? activePreset.name : "Custom"}
                      </Typography>
                    </Box>
                  </>
                )}

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Target Region:</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 500 }}>
                    {selectedRegionName} ({region.toUpperCase()})
                  </Typography>
                </Box>

                <Divider />

                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>Port Auto-Detection:</Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#10b981" }}>
                    {internalPort ? `Manual (${internalPort})` : "Enabled (0.0.0.0)"}
                  </Typography>
                </Box>
              </Stack>

              {error && (
                <Box
                  sx={{
                    borderRadius: 1.5,
                    border: "1px solid rgba(239,68,68,0.25)",
                    bgcolor: "rgba(239,68,68,0.08)",
                    p: 1.5,
                    fontSize: 12,
                    color: "var(--destructive)",
                  }}
                >
                  {error}
                </Box>
              )}

              <Stack spacing={1}>
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={deployMutation.isPending || !isFormValid}
                  startIcon={<Rocket style={{ width: 16, height: 16 }} />}
                >
                  {deployMutation.isPending
                    ? sourceType === "github"
                      ? "Starting Build Pipeline…"
                      : "Provisioning Machine…"
                    : sourceType === "github"
                    ? "Deploy from GitHub"
                    : "Deploy Container"}
                </Button>
                <Button
                  component={Link}
                  href="/apps"
                  variant="outlined"
                  fullWidth
                  disabled={deployMutation.isPending}
                >
                  Cancel
                </Button>
              </Stack>
            </Stack>

            <Stack
              spacing={1}
              sx={{
                borderRadius: 2.5,
                border: "1px solid var(--border)",
                bgcolor: "rgba(255,255,255,0.02)",
                p: 2,
              }}
            >
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <Sparkles style={{ width: 14, height: 14, color: "var(--primary)" }} />
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  Render &amp; Railway Style Deployment
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Applications are deployed directly into isolated microVMs with automatic port detection and free SSL.
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Stack>
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
