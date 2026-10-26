export interface FlyMachinePreset {
  id: string;
  name: string;
  label: string;
  cpuKind: "shared" | "performance";
  cpus: number;
  memoryMb: number;
  description: string;
  tierBadge?: string;
  monthlyEstimate?: string;
}

export const FLY_MACHINE_PRESETS: FlyMachinePreset[] = [
  {
    id: "shared-cpu-1x-256mb",
    name: "shared-cpu-1x (256MB)",
    label: "shared-cpu-1x · 1 Shared vCPU, 256 MB RAM (Free tier)",
    cpuKind: "shared",
    cpus: 1,
    memoryMb: 256,
    description: "Ideal for lightweight web servers, microservices, testing, and hobby apps.",
    tierBadge: "Free Tier",
    monthlyEstimate: "$0.00 / mo",
  },
  {
    id: "shared-cpu-1x-512mb",
    name: "shared-cpu-1x (512MB)",
    label: "shared-cpu-1x · 1 Shared vCPU, 512 MB RAM (Starter)",
    cpuKind: "shared",
    cpus: 1,
    memoryMb: 512,
    description: "Great for simple APIs, static sites with server functions, and webhooks.",
    tierBadge: "Starter",
    monthlyEstimate: "~$3.19 / mo",
  },
  {
    id: "shared-cpu-1x-1024mb",
    name: "shared-cpu-1x (1GB)",
    label: "shared-cpu-1x · 1 Shared vCPU, 1 GB RAM (Small App)",
    cpuKind: "shared",
    cpus: 1,
    memoryMb: 1024,
    description: "Recommended for Node.js, Python FastAPI, Go servers, and moderate web apps.",
    tierBadge: "Popular",
    monthlyEstimate: "~$5.70 / mo",
  },
  {
    id: "shared-cpu-2x-2048mb",
    name: "shared-cpu-2x (2GB)",
    label: "shared-cpu-2x · 2 Shared vCPUs, 2 GB RAM (Standard)",
    cpuKind: "shared",
    cpus: 2,
    memoryMb: 2048,
    description: "Full-stack apps, Next.js / Remix SSR backends, and background task runners.",
    tierBadge: "Recommended",
    monthlyEstimate: "~$11.40 / mo",
  },
  {
    id: "shared-cpu-2x-4096mb",
    name: "shared-cpu-2x (4GB)",
    label: "shared-cpu-2x · 2 Shared vCPUs, 4 GB RAM (Medium App)",
    cpuKind: "shared",
    cpus: 2,
    memoryMb: 4096,
    description: "High-memory web services, caching layers, and real-time WebSocket servers.",
    monthlyEstimate: "~$16.42 / mo",
  },
  {
    id: "shared-cpu-4x-4096mb",
    name: "shared-cpu-4x (4GB)",
    label: "shared-cpu-4x · 4 Shared vCPUs, 4 GB RAM (High Concurrency)",
    cpuKind: "shared",
    cpus: 4,
    memoryMb: 4096,
    description: "Parallel worker pools, image processing, and high-concurrency workloads.",
    monthlyEstimate: "~$22.80 / mo",
  },
  {
    id: "shared-cpu-4x-8192mb",
    name: "shared-cpu-4x (8GB)",
    label: "shared-cpu-4x · 4 Shared vCPUs, 8 GB RAM (Compute Intensive)",
    cpuKind: "shared",
    cpus: 4,
    memoryMb: 8192,
    description: "Large memory caching, data transformations, and CPU-intensive apps.",
    monthlyEstimate: "~$32.84 / mo",
  },
  {
    id: "performance-1x-2048mb",
    name: "performance-1x (2GB)",
    label: "performance-1x · 1 Dedicated CPU, 2 GB RAM (Production)",
    cpuKind: "performance",
    cpus: 1,
    memoryMb: 2048,
    description: "Dedicated CPU core with zero throttling for predictable latency.",
    tierBadge: "Dedicated",
    monthlyEstimate: "~$31.00 / mo",
  },
  {
    id: "performance-2x-4096mb",
    name: "performance-2x (4GB)",
    label: "performance-2x · 2 Dedicated CPUs, 4 GB RAM (High Performance)",
    cpuKind: "performance",
    cpus: 2,
    memoryMb: 4096,
    description: "Production databases, mission-critical services, and streaming workloads.",
    tierBadge: "Performance",
    monthlyEstimate: "~$62.00 / mo",
  },
  {
    id: "performance-4x-8192mb",
    name: "performance-4x (8GB)",
    label: "performance-4x · 4 Dedicated CPUs, 8 GB RAM (Heavy Workload)",
    cpuKind: "performance",
    cpus: 4,
    memoryMb: 8192,
    description: "Maximum dedicated compute power for high-throughput enterprise applications.",
    tierBadge: "Performance",
    monthlyEstimate: "~$124.00 / mo",
  },
];

export const DEFAULT_PRESET_ID = "shared-cpu-1x-256mb";

export function findPresetById(id: string): FlyMachinePreset | undefined {
  return FLY_MACHINE_PRESETS.find((p) => p.id === id);
}

export function findPresetByResources(
  cpus?: number,
  memoryMb?: number,
  cpuKind?: string,
): FlyMachinePreset | undefined {
  if (!cpus && !memoryMb) {
    return FLY_MACHINE_PRESETS[0];
  }
  return FLY_MACHINE_PRESETS.find(
    (p) =>
      p.cpus === cpus &&
      p.memoryMb === memoryMb &&
      (!cpuKind || p.cpuKind === cpuKind),
  );
}

export interface StarterTemplate {
  name: string;
  image: string;
  port: number;
  description: string;
  env?: Record<string, string>;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Nginx",
    image: "nginx:alpine",
    port: 80,
    description: "Fast web server & reverse proxy",
  },
  {
    name: "Node.js",
    image: "node:20-alpine",
    port: 3000,
    description: "Node.js JavaScript runtime",
  },
  {
    name: "Python FastAPI",
    image: "tiangolo/uvicorn-gunicorn-fastapi:python3.11",
    port: 80,
    description: "Modern Python high-performance API",
  },
  {
    name: "Caddy",
    image: "caddy:alpine",
    port: 80,
    description: "Automatic HTTPS web server",
  },
  {
    name: "Redis",
    image: "redis:alpine",
    port: 6379,
    description: "In-memory key-value data store",
  },
];
