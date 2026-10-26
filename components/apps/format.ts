import { FLY_REGIONS } from "@/lib/applications";

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatExactTime(value: string | null | undefined) {
  return formatDate(value);
}

export function formatRelativeTime(
  value: string | null | undefined,
  now: Date = new Date(),
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 5) return "just now";
  if (abs < 60) return `${abs} sec ago`;
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function regionName(code: string | null | undefined) {
  if (!code) return "—";
  const match = FLY_REGIONS.find((region) => region.code === code);
  return match?.name ?? code.toUpperCase();
}

export function formatGuestSize(
  guest: { cpu_kind?: string; cpus?: number; memory_mb?: number } | null | undefined,
) {
  if (!guest) return "—";
  const cpus = guest.cpus ?? 1;
  const memory = guest.memory_mb ?? 256;
  return `${cpus} CPU · ${memory} MB`;
}

/** Short display name for an image, e.g. `redis:alpine3.23`, with the full
 * path available separately for tooltips. */
export function shortImageName(image: string | null | undefined) {
  if (!image) return "—";
  const withoutScheme = image.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const lastSegment = withoutScheme.split("/").pop() ?? withoutScheme;
  if (lastSegment.length <= 28) return lastSegment;
  const [name, tag] = lastSegment.split(":");
  if (name && tag) {
    const shortName = name.length > 24 ? `${name.slice(0, 24)}…` : name;
    return `${shortName}:${tag}`;
  }
  return lastSegment.length > 28 ? `${lastSegment.slice(0, 28)}…` : lastSegment;
}