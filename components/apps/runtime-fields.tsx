"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Application } from "@/lib/applications";

export interface RuntimeFieldsValue {
  image: string;
  cpus: string;
  memoryMb: string;
  internalPort: string;
  envText: string;
}

export function emptyRuntimeFields(): RuntimeFieldsValue {
  return { image: "", cpus: "", memoryMb: "", internalPort: "", envText: "" };
}

export function runtimeFieldsFromApplication(
  application: Application,
): RuntimeFieldsValue {
  const runtime = application.runtime ?? {};
  return {
    image: runtime.image ?? "",
    cpus: runtime.guest?.cpus ? String(runtime.guest.cpus) : "",
    memoryMb: runtime.guest?.memory_mb ? String(runtime.guest.memory_mb) : "",
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
  if (fields.cpus.trim()) guest.cpus = Number(fields.cpus);
  if (fields.memoryMb.trim()) guest.memory_mb = Number(fields.memoryMb);
  if (Object.keys(guest).length) runtime.guest = guest;
  if (fields.internalPort.trim()) runtime.internalPort = Number(fields.internalPort);

  if (fields.envText.trim()) {
    let env: unknown;
    try {
      env = JSON.parse(fields.envText);
    } catch {
      throw new Error("Environment must be valid JSON.");
    }
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      throw new Error("Environment must be a JSON object.");
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-image">Image</Label>
        <Input
          id="runtime-image"
          name="image"
          type="text"
          placeholder="docker.io/library/nginx:alpine"
          value={value.image}
          onChange={(event) => onChange({ ...value, image: event.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
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
      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-port">Internal port</Label>
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
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="runtime-env">Environment variables (JSON)</Label>
        <Textarea
          id="runtime-env"
          name="env"
          rows={4}
          placeholder={'{"NODE_ENV": "production"}'}
          value={value.envText}
          onChange={(event) => onChange({ ...value, envText: event.target.value })}
        />
      </div>
    </div>
  );
}