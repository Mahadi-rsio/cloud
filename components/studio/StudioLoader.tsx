"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const Studio = dynamic(() => import("@/components/studio/Studio").then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  ),
});

export function StudioLoader() {
  return <Studio />;
}