"use client";

import * as React from "react";
import MuiDialog from "@mui/material/Dialog";
import MuiDialogContent from "@mui/material/DialogContent";
import MuiDialogTitle from "@mui/material/DialogTitle";
import MuiDialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import { X } from "lucide-react";
import { cn } from "cn";

interface DialogContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextType>({
  open: false,
  setOpen: () => {},
});

export function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (newOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(newOpen);
      }
      onOpenChange?.(newOpen);
    },
    [isControlled, onOpenChange]
  );

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({
  children,
  asChild,
  ...props
}: {
  children: React.ReactElement;
  asChild?: boolean;
  [key: string]: any;
}) {
  const { setOpen } = React.useContext(DialogContext);

  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      children.props.onClick?.(e);
      setOpen(true);
    },
    ...props,
  });
}

export function DialogPortal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function DialogOverlay({ className, ...props }: React.ComponentProps<"div">) {
  return null;
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open, setOpen } = React.useContext(DialogContext);

  return (
    <MuiDialog
      open={open}
      onClose={() => setOpen(false)}
      fullWidth
      maxWidth="sm"
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(6px)",
          },
        },
      }}
      PaperProps={{
        sx: {
          borderRadius: "16px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--card)",
          color: "var(--foreground)",
          p: { xs: 2.5, sm: 3 },
          m: { xs: 1.5, sm: 2 },
          width: { xs: "calc(100% - 24px)", sm: "auto" },
          backgroundImage: "none",
          position: "relative",
          maxHeight: "calc(100svh - 32px)",
          overflowY: "auto",
        },
      }}
      {...(props as any)}
    >
      <IconButton
        aria-label="Close dialog"
        onClick={() => setOpen(false)}
        size="small"
        sx={{
          position: "absolute",
          right: 12,
          top: 12,
          color: "var(--muted-foreground)",
          borderRadius: "8px",
          transition: "all 0.15s ease",
          "&:hover": {
            backgroundColor: "var(--accent)",
            color: "var(--foreground)",
          },
        }}
      >
        <X className="size-4" />
      </IconButton>
      <div className={cn("flex flex-col gap-4", className)}>{children}</div>
    </MuiDialog>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-border/40",
        className
      )}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn(
        "text-lg font-semibold tracking-tight text-foreground leading-snug",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground leading-normal", className)}
      {...props}
    />
  );
}
