import { cn } from "cn";

/** Cloudisy wordmark. `collapsed` renders the mark only (collapsed rail). */
export function Wordmark({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="size-4"
        >
          <path
            d="M7.2 17.5a4.3 4.3 0 1 1 .6-8.56 5.4 5.4 0 0 1 10.3 1.94A3.7 3.7 0 0 1 15.6 17.5H7.2Z"
            fill="currentColor"
          />
        </svg>
      </span>
      {!collapsed && (
        <span className="text-base font-semibold tracking-tight text-foreground">
          Cloudisy
        </span>
      )}
    </span>
  );
}