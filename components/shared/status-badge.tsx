import { cn } from "cn";

type Tone = "success" | "warning" | "danger" | "muted";

const TONE_STYLES: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  muted: "text-muted-foreground",
};

const DOT_STYLES: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  muted: "bg-muted-foreground",
};

const STATUS_TONE: Record<string, Tone> = {
  running: "success",
  started: "success",
  created: "success",
  provisioning: "warning",
  pending: "warning",
  starting: "warning",
  restarting: "warning",
  redeploying: "warning",
  stopping: "warning",
  failed: "danger",
  error: "danger",
  stopped: "muted",
  deleting: "muted",
  deleted: "muted",
  destroying: "muted",
  destroyed: "muted",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "muted";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

/** Status is always communicated with a dot AND text, never color alone. */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-semibold",
        TONE_STYLES[tone],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-2 shrink-0 rounded-full", DOT_STYLES[tone])}
      />
      {statusLabel(status)}
    </span>
  );
}