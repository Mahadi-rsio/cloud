import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { RuntimeInput } from "@/lib/validators/application";

const FLY_API_BASE = "https://api.machines.dev";
const FLY_REQUEST_TIMEOUT_MS = 20_000;

export type FlyMachineEvent = {
  id?: string;
  type?: string;
  status?: string;
  source?: string;
  timestamp?: number;
  message?: string;
  request?: Record<string, unknown>;
};

export type FlyMachine = {
  id: string;
  name?: string;
  state?: string;
  region?: string;
  private_ip?: string;
  version?: string;
  config?: Record<string, unknown>;
  events?: FlyMachineEvent[];
  created_at?: string;
  updated_at?: string;
};

export type FlyLogMessage = {
  id?: string;
  timestamp: string;
  message: string;
  level?: "info" | "warn" | "error" | "debug" | "system";
  instance?: string;
  region?: string;
};

export type FlyMachineConfig = Record<string, unknown>;

export class FlyApiError extends HttpError {
  providerStatus: number;
  body: unknown;

  constructor(
    message: string,
    providerStatus: number,
    body: unknown,
  ) {
    super("PROVIDER_ERROR", message, 422, body);
    this.name = "FlyApiError";
    this.providerStatus = providerStatus;
    this.body = body;
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function flyFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const env = await getEnv();
  if (!env.FLY_API_TOKEN) {
    throw new HttpError("PROVIDER_ERROR", "FLY_API_TOKEN is not configured.", 500);
  }

  const url = new URL(`${FLY_API_BASE}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const { query: _query, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  headers.set("Authorization", `Bearer ${env.FLY_API_TOKEN}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...requestInit,
    headers,
    signal: requestInit.signal ?? AbortSignal.timeout(FLY_REQUEST_TIMEOUT_MS),
  });
  const body = parseBody(await response.text());

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Fly API request failed with status ${response.status}.`;
    throw new FlyApiError(message, response.status, body);
  }

  return body as T;
}

export function buildServices(internalPort: number) {
  return [
    {
      protocol: "tcp",
      internal_port: internalPort,
      ports: [
        {
          port: 80,
          handlers: ["http"],
          force_https: true,
        },
        {
          port: 443,
          handlers: ["tls", "http"],
        },
      ],
      autostart: true,
      autostop: "stop",
      min_machines_running: 0,
    },
  ];
}

export function buildMachineConfig(
  runtime: RuntimeInput | undefined,
  defaultImage: string,
): FlyMachineConfig {
  const guest = {
    cpu_kind: "shared",
    cpus: 1,
    memory_mb: 256,
    ...runtime?.guest,
  };

  const internalPort = runtime?.internalPort ?? 80;

  return {
    image: runtime?.image ?? defaultImage,
    guest,
    ...(runtime?.env ? { env: runtime.env } : {}),
    services: buildServices(internalPort),
  };
}

export function mergeMachineConfig(
  current: FlyMachineConfig | undefined,
  runtime: RuntimeInput | undefined,
): FlyMachineConfig {
  const config: FlyMachineConfig = { ...(current ?? {}) };
  if (runtime?.image) config.image = runtime.image;
  if (runtime?.guest) {
    config.guest = {
      ...((config.guest as Record<string, unknown> | undefined) ?? {}),
      ...runtime.guest,
    };
  }
  if (runtime?.env) {
    config.env = {
      ...((config.env as Record<string, string> | undefined) ?? {}),
      ...runtime.env,
    };
  }
  if (runtime?.internalPort) {
    config.services = buildServices(runtime.internalPort);
  }
  return config;
}

/**
 * Create a Fly App. No IP is allocated here — that is a separate explicit
 * step (see `allocateSharedIpv4`) so we never accidentally create a dedicated
 * IPv4 or a paid IPv6.
 */
export async function createFlyApp(input: {
  name: string;
  orgSlug?: string;
  idempotencyKey?: string;
}) {
  return flyFetch<{ id: string; created_at: number }>("/v1/apps", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      org_slug: input.orgSlug || "personal",
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
    }),
  });
}

export type FlyIpAssignment = {
  ip?: string;
  shared?: boolean;
  region?: string;
  created_at?: string;
};

/**
 * Allocate a free shared IPv4 (Anycast) for the app so it is reachable at
 * `https://<app-name>.fly.dev`. This is the free option — it never allocates
 * a dedicated IPv4 or a public IPv6.
 */
export async function allocateSharedIpv4(appName: string) {
  return flyFetch<FlyIpAssignment>(
    `/v1/apps/${encodeURIComponent(appName)}/ip_assignments`,
    {
      method: "POST",
      body: JSON.stringify({ type: "shared_v4" }),
    },
  );
}

export async function destroyFlyApp(name: string) {
  return flyFetch<unknown>(`/v1/apps/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/**
 * Create a Fly Machine without requesting any public/dedicated IP or IPv6.
 * The machine only receives its private 6PN address (free, internal network).
 * Services config is written so the app can serve traffic once (and if) a
 * public IP is allocated later.
 */
export async function createFlyMachine(input: {
  appName: string;
  region: string;
  runtime?: RuntimeInput;
  name?: string;
}) {
  const env = await getEnv();
  const defaultImage = env.FLY_DEFAULT_IMAGE || "nginx:alpine";

  return flyFetch<FlyMachine>(`/v1/apps/${encodeURIComponent(input.appName)}/machines`, {
    method: "POST",
    body: JSON.stringify({
      ...(input.name ? { name: input.name } : {}),
      region: input.region,
      config: buildMachineConfig(input.runtime, defaultImage),
    }),
  });
}

export async function getFlyMachine(appName: string, machineId: string) {
  return flyFetch<FlyMachine>(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
  );
}

export async function listFlyMachines(appName: string) {
  return flyFetch<FlyMachine[]>(`/v1/apps/${encodeURIComponent(appName)}/machines`);
}

export async function updateFlyMachine(
  appName: string,
  machineId: string,
  input: {
    config: FlyMachineConfig;
    currentVersion?: string;
    region?: string;
  },
) {
  return flyFetch<FlyMachine>(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        config: input.config,
        ...(input.currentVersion ? { current_version: input.currentVersion } : {}),
        ...(input.region ? { region: input.region } : {}),
      }),
    },
  );
}

export async function destroyFlyMachine(
  appName: string,
  machineId: string,
  force = true,
) {
  return flyFetch<unknown>(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}`,
    {
      method: "DELETE",
      query: { force },
    },
  );
}

/** Explicitly start a stopped machine (used to wake the shared builder). */
export async function startFlyMachine(appName: string, machineId: string) {
  return flyFetch<unknown>(
    `/v1/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/start`,
    { method: "POST" },
  );
}

export function isFlyNotFound(error: unknown) {
  return error instanceof FlyApiError && error.providerStatus === 404;
}

export async function getFlyLogs(
  appName: string,
  options?: { instance?: string; region?: string },
): Promise<FlyLogMessage[]> {
  const env = await getEnv();
  if (!env.FLY_API_TOKEN) {
    return [];
  }

  const url = new URL(`https://api.fly.io/api/v1/apps/${encodeURIComponent(appName)}/logs`);
  if (options?.instance) url.searchParams.set("instance", options.instance);
  if (options?.region) url.searchParams.set("region", options.region);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${env.FLY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(FLY_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as {
      data?: Array<{
        id?: string;
        attributes?: {
          timestamp?: string;
          message?: string;
          level?: string;
          instance?: string;
          region?: string;
        };
      }>;
    };

    if (Array.isArray(json?.data)) {
      return json.data.map((item) => ({
        id: item.id,
        timestamp: item.attributes?.timestamp ?? new Date().toISOString(),
        message: item.attributes?.message ?? "",
        level: (item.attributes?.level as FlyLogMessage["level"]) ?? "info",
        instance: item.attributes?.instance,
        region: item.attributes?.region,
      }));
    }
    return [];
  } catch {
    return [];
  }
}
