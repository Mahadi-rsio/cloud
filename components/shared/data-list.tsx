import * as React from "react";
import { cn } from "cn";

/** A responsive definition list. Stacks label over value on narrow screens,
 * label/value side-by-side on wider screens. Rows are separated by hairlines,
 * not boxes. */
export function DataList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; hint?: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className="grid gap-1 py-3 sm:grid-cols-[minmax(9rem,13rem)_1fr] sm:gap-4"
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm text-foreground" title={item.hint}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}