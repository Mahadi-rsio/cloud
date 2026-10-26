import { cn } from "cn";

const STATUS_STYLES: Record<string, string> = {
  running: "bg-primary/10 text-primary",
  provisioning: "bg-secondary text-secondary-foreground",
  pending: "bg-secondary text-secondary-foreground",
  starting: "bg-secondary text-secondary-foreground",
  stopped: "bg-secondary text-secondary-foreground",
  restarting: "bg-secondary text-secondary-foreground",
  redeploying: "bg-secondary text-secondary-foreground",
  failed: "bg-destructive/10 text-destructive-foreground",
  deleting: "bg-muted text-muted-foreground",
  deleted: "bg-muted text-muted-foreground",
  destroying: "bg-muted text-muted-foreground",
  destroyed: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}