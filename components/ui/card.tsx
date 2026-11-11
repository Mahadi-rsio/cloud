"use client";

import * as React from "react";
import Paper from "@mui/material/Paper";
import { cn } from "cn";

interface CardProps extends React.ComponentProps<typeof Paper> {
  hoverable?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, elevation = 0, hoverable, ...props }, ref) => {
    return (
      <Paper
        ref={ref}
        elevation={elevation}
        data-slot="card"
        className={cn(
          "flex flex-col gap-4 sm:gap-5 rounded-xl border border-border bg-card p-4 sm:p-5 text-card-foreground transition-all duration-200",
          hoverable &&
            "hover:border-primary/40 hover:shadow-md dark:hover:border-primary/40",
          className
        )}
        {...props}
      />
    );
  }
);
Card.displayName = "Card";

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-3 sm:pb-4",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="card-title"
      className={cn(
        "text-base sm:text-lg font-semibold tracking-tight text-foreground leading-snug",
        className
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-xs sm:text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("flex items-center gap-2 self-start sm:self-center", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("flex-1 text-sm", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-3 sm:pt-4 text-xs sm:text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
