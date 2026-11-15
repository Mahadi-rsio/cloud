"use client";

import * as React from "react";
import { ConfirmDeleteDialog } from "./confirm-delete-dialog";

/** Reusable confirmation dialog for destructive or high-impact actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  confirmLabel = "Confirm",
  isPending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmText?: string;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmText={confirmText}
      confirmLabel={confirmLabel}
      isPending={isPending}
      onConfirm={onConfirm}
    />
  );
}
