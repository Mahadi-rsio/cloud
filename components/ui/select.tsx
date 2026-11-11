"use client";

import * as React from "react";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";

const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative inline-flex w-full items-center">
      <select
        ref={ref}
        data-slot="select"
        className={cn(
          "h-10 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent pl-3 pr-8 py-2 text-sm shadow-xs transition-all duration-150 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/20 cursor-pointer",
          "hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground transition-transform" />
    </div>
  );
});

Select.displayName = "Select";

export { Select };
