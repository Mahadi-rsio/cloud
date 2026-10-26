"use client";

import * as React from "react";
import { useState } from "react";
import { useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Cpu,
  Globe,
  HardDrive,
  Layers,
  Plus,
  Rocket,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import { createApplicationSchema } from "@/lib/validators/application";
import {
  createApplication,
  FLY_REGIONS,
  type Application,
} from "@/lib/applications";
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

  // App Basics
  const [name, setName] = useState("");
  const [region, setRegion] = useState("sin");

  // Machine Preset
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [customCpus, setCustomCpus] = useState("1");
  const [customMemory, setCustomMemory] = useState("256");

  // Container Runtime
  const [image, setImage] = useState("");
  const [internalPort, setInternalPort] = useState("80");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // Environment variables
  const [envMode, setEnvMode] = useState<"pairs" | "json">("pairs");
  const [envPairs, setEnvPairs] = useState<EnvPair[]>([
    { id: "1", key: "NODE_ENV", value: "production" },
  ]);
  const [envJson, setEnvJson] = useState('{\n  "NODE_ENV": "production"\n}');

  const [error, setError] = useState<string | null>(null);

  const activePreset: FlyMachinePreset | undefined =
    presetId !== "custom" ? findPresetById(presetId) : undefined;

  const handleApplyTemplate = (tpl: StarterTemplate) => {
    setSelectedTemplate(tpl.name);
    setImage(tpl.image);
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

  const handleAddEnvPair = () => {
    const newId = String(Date.now());
    setEnvPairs([...envPairs, { id: newId, key: "", value: "" }]);
  };

  const handleUpdateEnvPair = (id: string, field: "key" | "value", val: string) => {
    const updated = envPairs.map((p) => (p.id === id ? { ...p, [field]: val } : p));
    setEnvPairs(updated);
    // Sync JSON representation
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

  const create = useMutation({
    mutationFn: async () => {
      // Build runtime guest specs
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

      const runtimePayload = {
        ...(image.trim() ? { image: image.trim() } : {}),
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

      return createApplication(input);
    },
    onSuccess: ({ application }) => {
      router.push(`/apps/${application.id}`);
    },
    onError: (err) => {
      setError(extractErrorMessage(err));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };

  const selectedRegionName =
    FLY_REGIONS.find((r) => r.code === region)?.name || region;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 pb-16">
      {/* Top Breadcrumb & Navigation */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground">
          <Link href="/apps">
            <ArrowLeft className="size-4" />
            Back to Apps
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-1 border-b pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Create application
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure and deploy a containerized application to Fly.io microVMs with dedicated resources and automatic routing.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Form Controls */}
        <div className="flex flex-col gap-8 lg:col-span-2">
          {/* Card 1: App Basics */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center gap-2 border-b pb-3 font-semibold text-foreground">
              <Server className="size-4 text-primary" />
              <span>General Settings</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="app-name">Application Name *</Label>
              <Input
                id="app-name"
                name="name"
                type="text"
                autoComplete="off"
                placeholder="my-backend-app"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                A unique name for your application. This generates a public URL:{" "}
                <span className="font-mono text-foreground font-medium">
                  https://{name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "my-backend-app"}-[id].fly.dev
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
                Deploy close to your users or primary database to minimize latency.
              </p>
            </div>
          </div>

          {/* Card 2: Fly Machine Hardware Preset */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Cpu className="size-4 text-primary" />
                <span>Fly Machine Hardware Preset</span>
              </div>
              {activePreset?.tierBadge && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  <Sparkles className="size-3" />
                  {activePreset.tierBadge}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="machine-preset">Select Machine Sizing</Label>
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

            {/* Preset Details Card */}
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
                        {activePreset.monthlyEstimate || "Pay as you go"}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {activePreset.description}
                </p>
              </div>
            ) : null}

            {/* Custom inputs if chosen */}
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

          {/* Card 3: Container Image & Templates */}
          <div className="rounded-xl border bg-card p-6 shadow-xs flex flex-col gap-5">
            <div className="flex items-center gap-2 border-b pb-3 font-semibold text-foreground">
              <Layers className="size-4 text-primary" />
              <span>Container Image & Networking</span>
            </div>

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

            <div className="flex flex-col gap-2">
              <Label htmlFor="app-image">Docker Image</Label>
              <Input
                id="app-image"
                type="text"
                placeholder="docker.io/library/nginx:alpine"
                value={image}
                onChange={(e) => {
                  setImage(e.target.value);
                  setSelectedTemplate(null);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Defaults to nginx:alpine if omitted. You can use any public Docker Hub, GitHub Container Registry (ghcr.io), or Quay image.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="app-port">Container Internal Port</Label>
              <Input
                id="app-port"
                type="number"
                min={1}
                max={65535}
                placeholder="80"
                value={internalPort}
                onChange={(e) => setInternalPort(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The internal TCP port your server listens on inside the container. Fly will route incoming HTTP/HTTPS traffic from port 80/443 to this port.
              </p>
            </div>
          </div>

          {/* Card 4: Environment Variables */}
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
                      placeholder="KEY (e.g. PORT)"
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
                Deployment Summary
              </h2>

              <div className="flex flex-col gap-3.5 text-sm">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">App Name:</span>
                  <span className="font-medium text-foreground truncate max-w-[150px]">
                    {name || "(not specified)"}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Region:</span>
                  <span className="font-medium text-foreground">
                    {selectedRegionName} ({region.toUpperCase()})
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Machine Preset:</span>
                  <span className="font-medium text-foreground">
                    {activePreset ? activePreset.name : "Custom"}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">vCPU / RAM:</span>
                  <span className="font-medium text-foreground">
                    {activePreset
                      ? `${activePreset.cpus} vCPU · ${activePreset.memoryMb} MB`
                      : `${customCpus} vCPU · ${customMemory} MB`}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Container Image:</span>
                  <span className="font-mono text-xs text-foreground truncate max-w-[150px]">
                    {image || "nginx:alpine (default)"}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Target Port:</span>
                  <span className="font-mono text-xs text-foreground">
                    {internalPort || "80"}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs border-t pt-3">
                  <span className="text-muted-foreground">IPv4 Allocation:</span>
                  <span className="font-semibold text-primary">Shared Anycast (Free)</span>
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
                  disabled={create.isPending || !name.trim()}
                  className="w-full gap-2 font-medium"
                >
                  <Rocket className="size-4" />
                  {create.isPending ? "Provisioning Machine…" : "Create & Deploy App"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={create.isPending}
                  asChild
                  className="w-full"
                >
                  <Link href="/apps">Cancel</Link>
                </Button>
              </div>
            </div>

            {/* Info Callout */}
            <div className="rounded-xl border bg-muted/20 p-4 text-xs text-muted-foreground flex flex-col gap-2">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                Fly MicroVM Architecture
              </span>
              <p>
                Your application runs as an isolated microVM with its own kernel. Hardware resources are allocated based on your selected preset and traffic is routed via Fly Anycast network.
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
