"use client";

import * as React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppMuiProvider } from "@/lib/mui/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AppMuiProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={300}>
        {children}
      </TooltipProvider>
    </AppMuiProvider>
  );
}
