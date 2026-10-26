"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import type { Application } from "@/lib/applications";
import {
  DEFAULT_PRESET_ID,
  FLY_MACHINE_PRESETS,
  findPresetById,
  findPresetByResources,
  type FlyMachinePreset,
} from "./machine-presets";
import { Cpu, HardDrive, Sparkles } from "lucide-react";

export interface RuntimeFieldsValue {
  image: string;
  presetId: string;
  cpus: string;
  memoryMb: string;
  cpuKind: "shared" | "performance";
  internalPort: string;
  envText: string;
}

export function emptyRuntimeFields(): RuntimeFieldsValue {
  const defaultPreset = findPresetById(DEFAULT_PRESET_ID) || FLY_MACHINE_PRESETS[0];
  return {
    image: "",
    presetId: defaultPreset.id,
    cpus: String(defaultPreset.cpus),
    memoryMb: String(defaultPreset.memoryMb),
    cpuKind: defaultPreset.cpuKind,
    internalPort: "",
    envText: "",
  };
}

export function runtimeFieldsFromApplication(
  application: Application,
): RuntimeFieldsValue {
  const runtime = application.runtime ?? {};
  const cpus = runtime.guest?.cpus;
  const memoryMb = runtime.guest?.memory_mb;
  const cpuKind = (runtime.guest?.cpu_kind as "shared" | "performance") || "shared";

  const matched = findPresetByResources(cpus, memoryMb, cpuKind);
  const presetId = matched ? matched.id : "custom";

  return {
    image: runtime.image ?? "",
    presetId,
    cpus: cpus ? String(cpus) : matched ? String(matched.cpus) : "1",
    memoryMb: memoryMb ? String(memoryMb) : matched ? String(matched.memoryMb) : "256",
    cpuKind,
    internalPort: runtime.internalPort ? String(runtime.internalPort) : "",
    envText: runtime.env ? JSON.stringify(runtime.env, null, 2) : "",
  };
}

export function buildRuntimeInput(
  fields: RuntimeFieldsValue,
): Record<string, unknown> | undefined {
  const runtime: Record<string, unknown> = {};
  const guest: Record<string, unknown> = {};

  if (fields.image.trim()) runtime.image = fields.image.trim();

  let cpusNum = Number(fields.cpus);
  let memoryNum = Number(fields.memoryMb);
  let cpuKind = fields.cpuKind;

  if (fields.presetId !== "custom") {
    const preset = findPresetById(fields.presetId);
    if (preset) {
      cpusNum = preset.cpus;
      memoryNum = preset.memoryMb;
      cpuKind = preset.cpuKind;
    }
  }

  if (cpusNum > 0) guest.cpus = cpusNum;
  if (memoryNum > 0) guest.memory_mb = memoryNum;
  if (cpuKind) guest.cpu_kind = cpuKind;

  if (Object.keys(guest).length) runtime.guest = guest;
  if (fields.internalPort.trim()) runtime.internalPort = Number(fields.internalPort);

  if (fields.envText.trim()) {
    let env: unknown;
    try {
      env = JSON.parse(fields.envText);
    } catch {
      throw new Error("Environment variables must be valid JSON.");
    }
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      throw new Error("Environment variables must be a JSON object.");
    }
    runtime.env = env as Record<string, string>;
  }

  return Object.keys(runtime).length ? runtime : undefined;
}

export function RuntimeFields({
  value,
  onChange,
}: {
  value: RuntimeFieldsValue;
  onChange: (next: RuntimeFieldsValue) => void;
}) {
  const activePreset: FlyMachinePreset | undefined =
    value.presetId !== "custom" ? findPresetById(value.presetId) : undefined;

  const handlePresetChange = (presetId: string) => {
    if (presetId === "custom") {
      onChange({
        ...value,
        presetId: "custom",
      });
      return;
    }

    const preset = findPresetById(presetId);
    if (preset) {
      onChange({
        ...value,
        presetId: preset.id,
        cpus: String(preset.cpus),
        memoryMb: String(preset.memoryMb),
        cpuKind: preset.cpuKind,
      });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-image">Docker Image</Label>
        <Input
          id="runtime-image"
          name="image"
          type="text"
          placeholder="docker.io/library/nginx:alpine"
          value={value.image}
          onChange={(event) => onChange({ ...value, image: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Public Docker Hub or OCI registry container image URL.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="runtime-preset">Fly Machine Preset</Label>
          {activePreset?.tierBadge && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Sparkles className="size-3" />
              {activePreset.tierBadge}
            </span>
          )}
        </div>

        <Select
          id="runtime-preset"
          name="preset"
          value={value.presetId}
          onChange={(event) => handlePresetChange(event.target.value)}
        >
          <optgroup label="Shared CPU (General Purpose / Cost Efficient)">
            {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "shared").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Performance CPU (Dedicated Cores)">
            {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "performance").map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <option value="custom">Custom configuration…</option>
        </Select>

        {activePreset ? (
          <div className="rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground flex flex-col gap-1.5">
            <div className="flex items-center gap-4 text-foreground font-medium">
              <span className="inline-flex items-center gap-1">
                <Cpu className="size-3.5 text-primary" />
                {activePreset.cpus} {activePreset.cpuKind === "shared" ? "Shared vCPU" : "Dedicated CPU"}
                {activePreset.cpus > 1 ? "s" : ""}
              </span>
              <span className="inline-flex items-center gap-1">
                <HardDrive className="size-3.5 text-primary" />
                {activePreset.memoryMb >= 1024
                  ? `${activePreset.memoryMb / 1024} GB RAM`
                  : `${activePreset.memoryMb} MB RAM`}
              </span>
              {activePreset.monthlyEstimate && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {activePreset.monthlyEstimate}
                </span>
              )}
            </div>
            <p className="text-muted-foreground/80">{activePreset.description}</p>
          </div>
        ) : null}
      </div>

      {value.presetId === "custom" && (
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-dashed p-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="runtime-cpus">CPUs</Label>
            <Input
              id="runtime-cpus"
              name="cpus"
              type="number"
              min={1}
              max={16}
              placeholder="1"
              value={value.cpus}
              onChange={(event) => onChange({ ...value, cpus: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="runtime-memory">Memory (MB)</Label>
            <Input
              id="runtime-memory"
              name="memory_mb"
              type="number"
              min={256}
              max={32768}
              step={256}
              placeholder="256"
              value={value.memoryMb}
              onChange={(event) => onChange({ ...value, memoryMb: event.target.value })}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-port">Internal Container Port</Label>
        <Input
          id="runtime-port"
          name="internal_port"
          type="number"
          min={1}
          max={65535}
          placeholder="8080"
          value={value.internalPort}
          onChange={(event) =>
            onChange({ ...value, internalPort: event.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          The internal port your container listens on (e.g. 80 for Nginx, 3000 for Node, 8080 for web).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-env">Environment variables (JSON format)</Label>
        <Textarea
          id="runtime-env"
          name="env"
          rows={3}
          placeholder={'{"NODE_ENV": "production"}'}
          value={value.envText}
          onChange={(event) => onChange({ ...value, envText: event.target.value })}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}
