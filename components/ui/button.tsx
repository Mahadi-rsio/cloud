"use client";

import * as React from "react";
import ButtonBase from "@mui/material/ButtonBase";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 outline-none disabled:pointer-events-none disabled:opacity-50 select-none overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] shadow-xs",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] shadow-xs focus-visible:ring-2 focus-visible:ring-destructive/30",
        outline:
          "border border-border bg-background hover:bg-accent hover:text-accent-foreground active:scale-[0.98] shadow-xs dark:border-input dark:bg-input/20 dark:hover:bg-input/40",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:scale-[0.98]",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/40 active:bg-accent/60",
        link: "text-primary underline-offset-4 hover:underline p-0 h-auto font-medium",
      },
      size: {
        default: "h-9.5 px-4 py-2 has-[>svg]:px-3 text-sm",
        xs: "h-6.5 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8.5 gap-1.5 rounded-md px-3 text-xs sm:text-sm has-[>svg]:px-2.5",
        lg: "h-11 rounded-lg px-6 text-base has-[>svg]:px-4",
        icon: "size-9.5",
        "icon-xs": "size-6.5 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  disableRipple?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      disableRipple = false,
      type = "button",
      ...props
    },
    ref
  ) => {
    if (asChild) {
      return (
        <Slot.Root
          ref={ref as any}
          data-slot="button"
          data-variant={variant}
          data-size={size}
          className={cn(buttonVariants({ variant, size, className }))}
          {...(props as any)}
        />
      );
    }

    return (
      <ButtonBase
        ref={ref}
        type={type}
        disableRipple={disableRipple}
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...(props as any)}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
