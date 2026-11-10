"use client";

import * as React from "react";
import { Database, Loader2, PlugZap } from "lucide-react";
import { useStudioConnectionStore } from "@/stores/studio-connection";
import { useStudioIntentStore } from "@/stores/studio-intent";
import { studioApi } from "@/lib/studio-api";
import { listDatabases, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";

export function ConnectScreen() {
  const persistedName = useStudioConnectionStore((s) => s.name);

  const [databases, setDatabases] = React.useState<DatabaseItem[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);

  const loadDatabases = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listDatabases();
      setDatabases(data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  // If we navigated here from the databases page with a chosen database,
  // auto-connect to it.
  const autoConnected = React.useRef(false);
  React.useEffect(() => {
    if (autoConnected.current) return;
    const intent = useStudioIntentStore.getState();
    if (!intent.databaseId) {
      if (persistedName) setSelectedId(useStudioConnectionStore.getState().databaseId);
      return;
    }
    autoConnected.current = true;
    const targetId = intent.databaseId;
    const targetName = intent.name ?? "";
    useStudioIntentStore.getState().clearIntent();
    setSelectedId(targetId);
    void connectCore(targetId, targetName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectCore = async (databaseId: string, name: string) => {
    setError(null);
    setTesting(true);
    useStudioConnectionStore.getState().connect(databaseId, name, false);
    try {
      await studioApi.tables();
      useStudioConnectionStore.getState().setConnected(true);
    } catch (err) {
      setError(extractErrorMessage(err));
      setTesting(false);
    }
  };

  const handleConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const db = databases.find((d) => d.id === selectedId);
    setTesting(true);
    await connectCore(selectedId, db?.name ?? selectedId);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-5" />
          </div>
          <h1 className="text-lg font-semibold">Open a database</h1>
          <p className="text-sm text-muted-foreground">
            Pick one of your databases to explore its tables, data, and schema.
          </p>
        </div>

        <form onSubmit={handleConnect} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Database</label>
            {loading ? (
              <div className="flex h-24 items-center justify-center rounded-md border">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-center text-xs text-destructive">
                <span>{error}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadDatabases()}>
                  Retry
                </Button>
              </div>
            ) : databases.length === 0 ? (
              <p className="rounded-md border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
                You don't have any databases yet. Create one from the Dashboard.
              </p>
            ) : (
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
                {databases.map((db) => {
                  const selected = selectedId === db.id;
                  return (
                    <button
                      key={db.id}
                      type="button"
                      onClick={() => setSelectedId(db.id)}
                      className={
                        "flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                        (selected
                          ? "border-primary bg-primary/10"
                          : "border-muted hover:border-foreground/20 hover:bg-muted/40")
                      }
                    >
                      <Database className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{db.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                          {db.namespace}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {error && testing && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full gap-1.5"
            disabled={!selectedId || loading || testing}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlugZap className="size-4" />
            )}
            {testing ? "Connecting…" : "Open"}
          </Button>
        </form>
      </div>
    </div>
  );
}