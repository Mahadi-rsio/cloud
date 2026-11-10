"use client";

import * as React from "react";
import { Code2, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CopyField } from "@/components/shared/copy-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authRuntimeUrl, type AuthProjectItem } from "@/lib/auth-projects/client";

export function ConnectAuthProjectDialog({
  project,
  open,
  onOpenChange,
}: {
  project: AuthProjectItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [baseUrl, setBaseUrl] = React.useState("/api/auth-runtime");

  React.useEffect(() => {
    setBaseUrl(authRuntimeUrl());
  }, []);

  const clientCode = project
    ? `import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  baseURL: "${baseUrl}",
  fetchOptions: {
    headers: { "x-publishable-key": "${project.publishableKey}" },
    credentials: "include",
  },
});

await authClient.signUp.email({
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "supersecret123",
});`
    : "";

  const serverCode = project
    ? `import { createClient } from "@libsql/client";

// Direct database access (server-side only)
const db = createClient({
  url: "${project.httpUrl}",
  authToken: process.env.AUTH_DB_TOKEN!,
});`
    : "";

  const curlCode = project
    ? `curl -X POST ${baseUrl}/sign-up/email \\
  -H "Content-Type: application/json" \\
  -H "x-publishable-key: ${project.publishableKey}" \\
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"supersecret123"}'`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code2 className="size-5" />
          </div>
          <DialogTitle>Connect &ldquo;{project?.name}&rdquo;</DialogTitle>
          <DialogDescription>
            Point any Better Auth client at the shared runtime and send the
            project&rsquo;s publishable key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Auth base URL</span>
              <CopyField value={baseUrl} className="rounded bg-background px-2 py-1 border" />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Publishable key</span>
              <CopyField
                value={project?.publishableKey ?? ""}
                className="rounded bg-background px-2 py-1 border"
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Database namespace</span>
              <span className="truncate rounded bg-background px-2 py-1 font-mono text-foreground border">
                {project?.namespace}
              </span>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">HTTP URL</span>
              <CopyField
                value={project?.httpUrl ?? ""}
                className="rounded bg-background px-2 py-1 border"
              />
            </div>
          </div>

          <Tabs defaultValue="client">
            <TabsList>
              <TabsTrigger value="client">Client</TabsTrigger>
              <TabsTrigger value="curl">cURL</TabsTrigger>
              <TabsTrigger value="server">Database</TabsTrigger>
            </TabsList>
            <TabsContent value="client">
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                {clientCode}
              </pre>
            </TabsContent>
            <TabsContent value="curl">
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                {curlCode}
              </pre>
            </TabsContent>
            <TabsContent value="server">
              <div className="flex flex-col gap-2">
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-[11px] leading-relaxed">
                  {serverCode}
                </pre>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ShieldCheck className="size-3.5 text-primary" />
                  The database token is private. Retrieve it from the API or
                  dashboard credentials when needed.
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
