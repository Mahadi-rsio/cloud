"use client";

import * as React from "react";
import { AppMuiProvider } from "@/lib/mui/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AppMuiProvider>{children}</AppMuiProvider>;
}
