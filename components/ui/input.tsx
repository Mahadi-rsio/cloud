"use client";

import * as React from "react";
import { cn } from "cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", startAdornment, endAdornment, ...props }, ref) => {
    const inputElement = (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-all duration-150 outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/20",
          "hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20",
          "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20",
          startAdornment && "pl-10",
          endAdornment && "pr-10",
          className
        )}
        {...props}
      />
    );

    if (!startAdornment && !endAdornment) {
      return inputElement;
    }

    return (
      <div className="relative flex w-full items-center">
        {startAdornment && (
          <div className="pointer-events-none absolute left-3 flex items-center text-muted-foreground">
            {startAdornment}
          </div>
        )}
        {inputElement}
        {endAdornment && (
          <div className="absolute right-3 flex items-center text-muted-foreground">
            {endAdornment}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export { Input };
