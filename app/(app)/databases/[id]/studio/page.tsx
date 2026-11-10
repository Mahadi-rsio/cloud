"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2, Table, ShieldCheck, Database as DbIcon, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDatabase, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";

const DatabaseStudioView = dynamic(
  () => import("@/components/databases/database-studio-view"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[400px] w-full flex-col items-center justify-center gap-3 text-muted-foreground p-8">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Connecting to libSQL Studio GUI...</p>
        <p className="text-xs text-muted-foreground">Initializing driver and schema cache</p>
      </div>
    ),
  },
);

interface StudioPageProps {
  params: Promise<{ id: string }>;
}

export default function DatabaseStudioPage({ params }: StudioPageProps) {
  const [database, setDatabase] = React.useState<DatabaseItem | null>(null);
  const [databaseId, setDatabaseId] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    params.then((resolved) => {
      if (active) {
        setDatabaseId(resolved.id);
      }
    });
    return () => {
      active = false;
    };
  }, [params]);

  const loadData = React.useCallback(async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getDatabase(id);
      setDatabase(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (databaseId) {
      void loadData(databaseId);
    }
  }, [databaseId, loadData]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] w-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Loading database details...</p>
      </div>
    );
  }

  if (error || !database) {
    return (
      <div className="flex h-[calc(100vh-4rem)] w-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <div className="max-w-md space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Database Not Found</h2>
          <p className="text-sm text-muted-foreground">
            {error || "Could not load database configuration."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {databaseId && (
            <Button variant="outline" size="sm" onClick={() => void loadData(databaseId)}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/databases">
              <ArrowLeft className="mr-2 size-4" />
              Back to Databases
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-background">
      {/* Top Header Bar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b bg-card/80 px-3 sm:px-4 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
            <Link href="/databases">
              <ArrowLeft className="mr-1 size-3.5" />
              <span className="hidden sm:inline">Databases</span>
            </Link>
          </Button>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
              <Table className="size-3.5" />
            </div>
            <span className="font-semibold text-xs sm:text-sm text-foreground truncate max-w-[140px] sm:max-w-[240px]">
              {database.name}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground truncate max-w-[120px] sm:max-w-[180px]">
              {database.namespace}
            </span>
            <span className="hidden md:inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
              <ShieldCheck className="size-3" />
              Secured
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            fly.dev:443
          </span>
          <Button asChild variant="outline" size="sm" className="h-7 text-xs px-2.5">
            <Link href="/databases">Exit Studio</Link>
          </Button>
        </div>
      </div>

      {/* Main Studio Viewport */}
      <div className="relative flex-1 w-full min-h-0 overflow-hidden bg-background">
        <DatabaseStudioView database={database} theme="dark" />
      </div>
    </div>
  );
}
