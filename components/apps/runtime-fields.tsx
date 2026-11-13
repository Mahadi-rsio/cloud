"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <TextField
        id="runtime-image"
        name="image"
        label="Docker Image"
        type="text"
        size="small"
        fullWidth
        placeholder="docker.io/library/nginx:alpine"
        value={value.image}
        onChange={(event) => onChange({ ...value, image: event.target.value })}
        helperText="Public Docker Hub or OCI registry container image URL."
      />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Fly Machine Preset
          </Typography>
          {activePreset?.tierBadge && (
            <Chip
              size="small"
              icon={<Sparkles size={12} />}
              label={activePreset.tierBadge}
              sx={{
                height: 20,
                fontSize: "0.7rem",
                backgroundColor: "rgba(56, 189, 248, 0.12)",
                color: "var(--primary)",
              }}
            />
          )}
        </Box>

        <TextField
          id="runtime-preset"
          name="preset"
          select
          size="small"
          fullWidth
          value={value.presetId}
          onChange={(event) => handlePresetChange(event.target.value)}
        >
          <ListSubheader>Shared CPU (General Purpose / Cost Efficient)</ListSubheader>
          {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "shared").map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
          <ListSubheader>Performance CPU (Dedicated Cores)</ListSubheader>
          {FLY_MACHINE_PRESETS.filter((p) => p.cpuKind === "performance").map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.label}
            </MenuItem>
          ))}
          <MenuItem value="custom">Custom configuration…</MenuItem>
        </TextField>

        {activePreset && (
          <Paper
            variant="outlined"
            sx={{
              p: 1.25,
              borderRadius: "8px",
              backgroundColor: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", fontWeight: 500 }}>
                <Cpu size={14} color="var(--primary)" />
                {activePreset.cpus} {activePreset.cpuKind === "shared" ? "Shared vCPU" : "Dedicated CPU"}
                {activePreset.cpus > 1 ? "s" : ""}
              </Box>
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: "0.75rem", fontWeight: 500 }}>
                <HardDrive size={14} color="var(--primary)" />
                {activePreset.memoryMb >= 1024
                  ? `${activePreset.memoryMb / 1024} GB RAM`
                  : `${activePreset.memoryMb} MB RAM`}
              </Box>
              {activePreset.monthlyEstimate && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
                  {activePreset.monthlyEstimate}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {activePreset.description}
            </Typography>
          </Paper>
        )}
      </Box>

      {value.presetId === "custom" && (
        <Paper
          variant="outlined"
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            borderStyle: "dashed",
            p: 1.5,
          }}
        >
          <TextField
            id="runtime-cpus"
            name="cpus"
            label="CPUs"
            type="number"
            size="small"
            placeholder="1"
            value={value.cpus}
            onChange={(event) => onChange({ ...value, cpus: event.target.value })}
            slotProps={{ htmlInput: { min: 1, max: 16 } }}
          />
          <TextField
            id="runtime-memory"
            name="memory_mb"
            label="Memory (MB)"
            type="number"
            size="small"
            placeholder="256"
            value={value.memoryMb}
            onChange={(event) => onChange({ ...value, memoryMb: event.target.value })}
            slotProps={{ htmlInput: { min: 256, max: 32768, step: 256 } }}
          />
        </Paper>
      )}

      <TextField
        id="runtime-port"
        name="internal_port"
        label="Internal Container Port"
        type="number"
        size="small"
        fullWidth
        placeholder="8080"
        value={value.internalPort}
        onChange={(event) =>
          onChange({ ...value, internalPort: event.target.value })
        }
        slotProps={{ htmlInput: { min: 1, max: 65535 } }}
        helperText="The internal port your container listens on (e.g. 80 for Nginx, 3000 for Node, 8080 for web)."
      />

      <TextField
        id="runtime-env"
        name="env"
        label="Environment variables (JSON format)"
        multiline
        rows={3}
        size="small"
        fullWidth
        placeholder={'{"NODE_ENV": "production"}'}
        value={value.envText}
        onChange={(event) => onChange({ ...value, envText: event.target.value })}
        slotProps={{
          input: {
            sx: { fontFamily: "var(--font-mono)", fontSize: "0.75rem" },
          },
        }}
      />
    </Box>
  );
}
