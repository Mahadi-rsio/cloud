"use client";

import * as React from "react";
import { useState, useId } from "react";
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Cpu,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Plus,
  Rocket,
  Server,
  Sparkles,
  Trash2,
  ExternalLink,
  Box,
  CheckCircle2,
  AlertCircle,
  FolderGit2,
} from "lucide-react";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className || "size-4"}
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
import { createApplicationSchema } from "@/lib/validators/application";
import {
  createApplication,
  FLY_REGIONS,
} from "@/lib/applications";
import { createDeployment, validateDeployment, type ValidatedRepository } from "@/lib/deployments";
import { parseDockerInput, type ParsedDockerImage } from "@/lib/docker";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_PRESET_ID,
  FLY_MACHINE_PRESETS,
  STARTER_TEMPLATES,
  findPresetById,
  type FlyMachinePreset,
  type StarterTemplate,
} from "./machine-presets";

type EnvPair = { id: string; key: string; value: string };

function CreateApplicationContent() {
  const router = useRouter();

  // Deployment Source Tab: "github" | "docker"
  const [sourceType, setSourceType] = useState<"github" | "docker">("github");

  // App Basics
  const [name, setName] = useState("");
  const [region, setRegion] = useState("sin");

  // GitHub Source State
  const [repoUrl, setRepoUrl] = useState("");
  const [repoBranch, setRepoBranch] = useState("");
  const [isValidatingRepo, setIsValidatingRepo] = useState(false);
  const [repoPreview, setRepoPreview] = useState<ValidatedRepository | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);

  // Docker Source State
  const [dockerInputRaw, setDockerInputRaw] = useState("");
  const [dockerParsed, setDockerParsed] = useState<ParsedDockerImage | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // Machine Preset
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [customCpus, setCustomCpus] = useState("1");
  const [customMemory, setCustomMemory] = useState("256");

  // Networking Port (Optional override)
  const [internalPort, setInternalPort] = useState("");

  // Environment variables
  const [envMode, setEnvMode] = useState<"pairs" | "json">("pairs");
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([
    { id: "1", key: "NODE_ENV", value: "production" },
  ]);
  const [envJson, setEnvJson] = useState('{\n  "NODE_ENV": "production"\n}');

  const [error, setError] = useState<string | null>(null);

  const activePreset: FlyMachinePreset | undefined =
    presetId !== "custom" ? findPresetById(presetId) : undefined;

  // Handle docker raw input change & auto-detect registry
  const handleDockerInputChange = (val: string) => {
    setDockerInputRaw(val);
    setSelectedTemplate(null);
    if (!val.trim()) {
      setDockerParsed(null);
      return;
    }
    const parsed = parseDockerInput(val);
    setDockerParsed(parsed);
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

  // Validate GitHub repo on blur or button click
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
          // Auto-suggest app name from repo name
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
      // Build environment variables
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
        // Deploy via GitHub build pipeline
        const deployment = await createDeployment({
          url: trimmedUrl,
          ...(repoBranch.trim() ? { branch: repoBranch.trim() } : {}),
        });
        return { type: "github" as const, deploymentId: deployment.id };
      }

      // Docker deploy
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

  const selectedRegionName =
    FLY_REGIONS.find((r) => r.code === region)?.name || region;

  const isFormValid =
    name.trim().length >= 2 &&
    (sourceType === "github" ? repoUrl.trim().length > 0 : true);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 pb-16">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
        >
          <Link href="/apps">
            <ArrowLeft className="size-4" />
            Back to Apps
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-1 border-b pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Create & Deploy App
        </h1>
        <p className="text-sm text-muted-foreground">
          Deploy your service from a public GitHub repository with automatic builds, or directly from any Docker container image.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Form Controls */}
        <div className="flex flex-col gap-8 lg:col-span-2">
          {/* Section 1: Application Identity */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center gap-2 border-b pb-3 font-semibold text-foreground">
              <Server className="size-4 text-primary" />
              <span>Application Details</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="app-name">Application Name *</Label>
              <Input
                id="app-name"
                name="name"
                type="text"
                autoComplete="off"
                placeholder="my-cool-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                A unique identifier for your app. Your app will receive a secure URL:{" "}
                <span className="font-mono text-foreground font-medium">
                  https://{name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "my-cool-app"}-[id].fly.dev
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="app-region">Primary Region</Label>
              <Select
                id="app-region"
                name="region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              >
                {FLY_REGIONS.map(({ code, name: rName }) => (
                  <option key={code} value={code}>
                    {rName} ({code.toUpperCase()})
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Deploy close to your users or database to minimize latency.
              </p>
            </div>
          </div>

          {/* Section 2: Pick Source (GitHub vs Docker) */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Layers className="size-4 text-primary" />
                <span>Deployment Source</span>
              </div>
              <span className="text-xs text-muted-foreground">Select how your code is packaged</span>
            </div>

            {/* Source Tabs */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSourceType("github")}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-all ${
                  sourceType === "github"
                    ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                    : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <GitHubIcon className="size-4.5" />
                    <span>GitHub Repository</span>
                  </div>
                  {sourceType === "github" && (
                    <CheckCircle2 className="size-4 text-primary" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Build automatically from source code using Railpack or Dockerfile.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setSourceType("docker")}
                className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-all ${
                  sourceType === "docker"
                    ? "border-primary bg-primary/5 shadow-xs ring-1 ring-primary"
                    : "border-border bg-background hover:bg-muted/50 text-muted-foreground"
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-foreground">
                    <Box className="size-4.5" />
                    <span>Docker Container</span>
                  </div>
                  {sourceType === "docker" && (
                    <CheckCircle2 className="size-4 text-primary" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Deploy pre-built image from Docker Hub, GHCR, Quay, or any registry.
                </p>
              </button>
            </div>

            {/* TAB CONTENT: GITHUB */}
            {sourceType === "github" && (
              <div className="flex flex-col gap-5 pt-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="repo-url">Public GitHub Repository URL *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="repo-url"
                      type="url"
                      placeholder="https://github.com/username/my-project"
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        setRepoPreview(null);
                        setRepoError(null);
                      }}
                      onBlur={() => void handleValidateGitHub()}
                      className="font-mono text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleValidateGitHub()}
                      disabled={isValidatingRepo || !repoUrl.trim()}
                      className="shrink-0 text-xs"
                    >
                      {isValidatingRepo ? "Checking…" : "Verify"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Any public GitHub repository. Railpack detects Next.js, Node.js, Python, Go, Rust, Ruby, PHP, and SvelteKit automatically.
                  </p>
                </div>

                {repoError && (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{repoError}</span>
                  </div>
                )}

                {repoPreview && (
                  <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GitBranch className="size-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {repoPreview.owner}/{repoPreview.name}
                        </span>
                      </div>
                      <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase">
                        Verified
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1 text-xs sm:grid-cols-3">
                      <div>
                        <span className="text-muted-foreground">Default Branch:</span>
                        <p className="font-mono font-medium text-foreground">{repoPreview.defaultBranch}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Repository Type:</span>
                        <p className="font-medium text-foreground">{repoPreview.fork ? "Fork" : "Original"}</p>
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <span className="text-muted-foreground">Detection:</span>
                        <p className="font-medium text-emerald-600 dark:text-emerald-400">Ready to build</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Label htmlFor="repo-branch">Branch (optional)</Label>
                  <Input
                    id="repo-branch"
                    type="text"
                    placeholder={repoPreview?.defaultBranch || "main"}
                    value={repoBranch}
                    onChange={(e) => setRepoBranch(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to deploy the repository's default branch ({repoPreview?.defaultBranch || "main"}).
                  </p>
                </div>

                {/* Connect GitHub Account Section / Repos List Placeholder */}
                <div className="mt-2 rounded-xl border border-dashed bg-muted/20 p-5 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted text-foreground">
                    <GitHubIcon className="size-5" />
                  </div>
                  <div className="flex flex-col gap-1 max-w-sm">
                    <span className="text-sm font-semibold text-foreground">
                      Deploy your private & organization repositories
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Connect your GitHub account to browse and pick repositories directly without copying URLs.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 text-xs font-medium"
                    onClick={() => {
                      alert("GitHub OAuth account connection is coming soon. You can deploy any public GitHub repository right now by entering the URL above!");
                    }}
                  >
                    <GitHubIcon className="size-3.5" />
                    Connect GitHub
                  </Button>
                </div>
              </div>
            )}

            {/* TAB CONTENT: DOCKER */}
            {sourceType === "docker" && (
              <div className="flex flex-col gap-5 pt-2">
                {/* Quick starter chips */}
                <div className="flex flex-col gap-2">
                  <Label className="text-xs text-muted-foreground font-normal">
                    Quick start with common templates (optional):
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {STARTER_TEMPLATES.map((tpl) => (
                      <button
                        key={tpl.name}
                        type="button"
                        onClick={() => handleApplyTemplate(tpl)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selectedTemplate === tpl.name
                            ? "border-primary bg-primary/10 text-primary font-semibold"
                            : "border-border bg-background hover:bg-muted text-foreground"
                        }`}
                      >
                        {selectedTemplate === tpl.name && <Check className="size-3" />}
                        <span>{tpl.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pull Command / Image Input */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="docker-pull-cmd">Docker Image or Pull Command</Label>
                  <Input
                    id="docker-pull-cmd"
                    type="text"
                    placeholder="docker pull ghcr.io/username/repo:latest or nginx:alpine"
                    value={dockerInputRaw}
                    onChange={(e) => handleDockerInputChange(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Paste an image name or full pull command (e.g. <span className="font-mono">docker pull ghcr.io/owner/app:v1</span>). The registry is detected automatically.
                  </p>
                </div>

                {/* Auto-detected Registry Badge */}
                {dockerParsed && (
                  <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Box className="size-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Detected Registry:</span>
                        <span className="text-xs font-semibold text-foreground">
                          {dockerParsed.registryLabel}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end text-xs">
                      <span className="text-muted-foreground">Resolved Image:</span>
                      <span className="font-mono font-medium text-foreground">
                        {dockerParsed.cleanedImage}
                      </span>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Label htmlFor="app-port">Container Internal Port (optional)</Label>
                  <Input
                    id="app-port"
                    type="number"
                    min={1}
                    max={65535}
                    placeholder="Auto-detected (e.g. 80, 3000, 8080)"
                    value={internalPort}
                    onChange={(e) => setInternalPort(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use intelligent automatic port detection after deploy, or specify an exact port.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Machine Hardware Preset (Only applicable for Docker or direct VM provisioning) */}
          {sourceType === "docker" && (
            <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Cpu className="size-4 text-primary" />
                  <span>Hardware Sizing</span>
                </div>
                {activePreset?.tierBadge && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    <Sparkles className="size-3" />
                    {activePreset.tierBadge}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="machine-preset">Select Machine Preset</Label>
                <Select
                  id="machine-preset"
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  <optgroup label="Shared CPU (Cost Efficient / General Workloads)">
                    {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "shared").map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Performance CPU (Dedicated Cores / Production)">
                    {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "performance").map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                  <option value="custom">Custom specifications…</option>
                </Select>
              </div>

              {activePreset ? (
                <div className="rounded-lg border bg-muted/30 p-4 flex flex-col gap-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border">
                      <Cpu className="size-4 text-primary shrink-0" />
                      <div className="flex flex-col text-xs">
                        <span className="text-muted-foreground">vCPU</span>
                        <span className="font-semibold text-foreground">
                          {activePreset.cpus} {activePreset.cpuKind === "shared" ? "Shared" : "Dedicated"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border">
                      <HardDrive className="size-4 text-primary shrink-0" />
                      <div className="flex flex-col text-xs">
                        <span className="text-muted-foreground">RAM</span>
                        <span className="font-semibold text-foreground">
                          {activePreset.memoryMb >= 1024
                            ? `${activePreset.memoryMb / 1024} GB`
                            : `${activePreset.memoryMb} MB`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-background/80 p-2.5 border col-span-2 sm:col-span-1">
                      <Globe className="size-4 text-primary shrink-0" />
                      <div className="flex flex-col text-xs">
                        <span className="text-muted-foreground">Estimated Cost</span>
                        <span className="font-semibold text-foreground">
                          {activePreset.monthlyEstimate || "Free tier"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {activePreset.description}
                  </p>
                </div>
              ) : null}

              {presetId === "custom" && (
                <div className="grid grid-cols-2 gap-4 rounded-lg border border-dashed p-4 bg-muted/10">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="custom-cpus">vCPUs</Label>
                    <Input
                      id="custom-cpus"
                      type="number"
                      min={1}
                      max={16}
                      value={customCpus}
                      onChange={(e) => setCustomCpus(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="custom-memory">Memory (MB)</Label>
                    <Input
                      id="custom-memory"
                      type="number"
                      min={256}
                      max={32768}
                      step={256}
                      value={customMemory}
                      onChange={(e) => setCustomMemory(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Section 4: Environment Variables */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <span>Environment Variables</span>
              </div>
              <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setEnvMode("pairs")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    envMode === "pairs"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Key-Value
                </button>
                <button
                  type="button"
                  onClick={() => setEnvMode("json")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    envMode === "json"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Raw JSON
                </button>
              </div>
            </div>

            {envMode === "pairs" ? (
              <div className="flex flex-col gap-3">
                {envPairs.map((pair) => (
                  <div key={pair.id} className="flex items-center gap-2">
                    <Input
                      placeholder="KEY (e.g. DATABASE_URL)"
                      value={pair.key}
                      onChange={(e) => handleUpdateEnvPair(pair.id, "key", e.target.value)}
                      className="font-mono text-xs uppercase"
                    />
                    <Input
                      placeholder="Value"
                      value={pair.value}
                      onChange={(e) => handleUpdateEnvPair(pair.id, "value", e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemoveEnvPair(pair.id)}
                      className="text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remove variable"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddEnvPair}
                  className="w-fit gap-1 text-xs"
                >
                  <Plus className="size-3.5" />
                  Add Variable
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Textarea
                  rows={5}
                  value={envJson}
                  onChange={(e) => setEnvJson(e.target.value)}
                  className="font-mono text-xs"
                  placeholder='{\n  "KEY": "value"\n}'
                />
                <p className="text-xs text-muted-foreground">
                  Provide a valid JSON key-value object of strings.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Deployment Summary & Actions */}
        <div className="flex flex-col gap-6">
          <div className="sticky top-6 flex flex-col gap-6">
            <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
              <h2 className="font-semibold text-foreground border-b pb-3">
                Deploy Summary
              </h2>

              <div className="flex flex-col gap-3.5 text-sm">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">App Name:</span>
                  <span className="font-medium text-foreground truncate max-w-[150px]">
                    {name || "(not specified)"}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Source Type:</span>
                  <span className="font-semibold text-foreground uppercase text-[11px] bg-muted px-2 py-0.5 rounded">
                    {sourceType === "github" ? "GitHub Repository" : "Docker Container"}
                  </span>
                </div>

                {sourceType === "github" ? (
                  <>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Repository:</span>
                      <span className="font-mono text-xs text-foreground truncate max-w-[150px]">
                        {repoPreview ? `${repoPreview.owner}/${repoPreview.name}` : repoUrl || "(not entered)"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Branch:</span>
                      <span className="font-mono text-xs text-foreground">
                        {repoBranch || repoPreview?.defaultBranch || "main"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Build Engine:</span>
                      <span className="text-primary font-medium">Railpack / BuildKit</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Container Image:</span>
                      <span className="font-mono text-xs text-foreground truncate max-w-[150px]">
                        {dockerParsed ? dockerParsed.cleanedImage : dockerInputRaw || "nginx:alpine (default)"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Registry:</span>
                      <span className="font-medium text-foreground">
                        {dockerParsed ? dockerParsed.registryLabel : "Docker Hub"}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Machine Sizing:</span>
                      <span className="font-medium text-foreground">
                        {activePreset ? activePreset.name : "Custom"}
                      </span>
                    </div>
                  </>
                )}

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Target Region:</span>
                  <span className="font-medium text-foreground">
                    {selectedRegionName} ({region.toUpperCase()})
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs border-t pt-3">
                  <span className="text-muted-foreground">Port Auto-Detection:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {internalPort ? `Manual (${internalPort})` : "Enabled (0.0.0.0)"}
                  </span>
                </div>
              </div>

              {error && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2">
                <Button
                  type="submit"
                  size="lg"
                  disabled={deployMutation.isPending || !isFormValid}
                  className="w-full gap-2 font-medium"
                >
                  <Rocket className="size-4" />
                  {deployMutation.isPending
                    ? sourceType === "github"
                      ? "Starting Build Pipeline…"
                      : "Provisioning Machine…"
                    : sourceType === "github"
                    ? "Deploy from GitHub"
                    : "Deploy Container"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={deployMutation.isPending}
                  asChild
                  className="w-full"
                >
                  <Link href="/apps">Cancel</Link>
                </Button>
              </div>
            </div>

            {/* Architecture Tip */}
            <div className="rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground flex flex-col gap-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                Render & Railway Style Deployment
              </span>
              <p>
                Applications are deployed directly into isolated microVMs with automatic port detection and free SSL.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
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
