"use client";

import * as React from "react";
import { Copy, Check, Terminal, Code2, Layers, KeyRound, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CopyField } from "@/components/shared/copy-field";
import type { DatabaseItem } from "@/lib/databases/client";

function CodeSnippet({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-lg border bg-zinc-950 p-4 font-mono text-xs text-zinc-100 dark:bg-zinc-950/80">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleCopy}
        className="absolute top-2.5 right-2.5 size-7 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-400" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
      <pre className="overflow-x-auto pr-8 leading-relaxed whitespace-pre font-mono">
        {code}
      </pre>
    </div>
  );
}

export function ConnectDatabaseDialog({
  database,
  open,
  onOpenChange,
}: {
  database: DatabaseItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!database) return null;

  const url = database.libsqlUrl;
  const httpUrl = database.httpUrl;
  const token = database.defaultToken;

  const tsCode = `// 1. Install client:
// npm install @libsql/client

import { createClient } from "@libsql/client";

const db = createClient({
  url: "${url}",
  authToken: "${token}",
});

// Execute queries
const result = await db.execute("SELECT datetime('now') AS current_time;");
console.log(result.rows);`;

  const drizzleCode = `// 1. Install packages:
// npm install drizzle-orm @libsql/client
// npm install -D drizzle-kit

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const client = createClient({
  url: "${url}",
  authToken: "${token}",
});

export const db = drizzle(client);`;

  const pythonCode = `# 1. Install client:
# pip install libsql-client

import libsql_client

client = libsql_client.create_client_sync(
    url="${url}",
    auth_token="${token}",
)

res = client.execute("SELECT 1 + 1 AS answer;")
print(res.rows)`;

  const curlCode = `# HTTP Pipeline API
curl -X POST "${httpUrl}/v2/pipeline" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "requests": [
      {
        "type": "execute",
        "stmt": {
          "sql": "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, content TEXT);"
        }
      },
      {
        "type": "execute",
        "stmt": {
          "sql": "INSERT INTO notes (content) VALUES (?);",
          "args": [{"type": "text", "value": "Hello from Cloud!"}]
        }
      },
      {
        "type": "execute",
        "stmt": {
          "sql": "SELECT * FROM notes;"
        }
      }
    ]
  }'`;

  const envCode = `DATABASE_URL="${url}"
DATABASE_AUTH_TOKEN="${token}"`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Code2 className="size-5" />
            </div>
            <div>
              <DialogTitle>Connect to {database.name}</DialogTitle>
              <DialogDescription className="text-xs">
                Namespace: <span className="font-mono text-foreground">{database.namespace}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Quick connection parameters */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5 text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Globe className="size-3.5" /> LibSQL Connection URL
              </span>
              <CopyField
                value={url}
                className="rounded bg-background px-2.5 py-1.5 border"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <KeyRound className="size-3.5" /> Primary Auth Token
              </span>
              <CopyField
                value={token}
                className="rounded bg-background px-2.5 py-1.5 border"
              />
            </div>
          </div>

          {/* Connection tabs */}
          <Tabs defaultValue="ts" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="ts" className="gap-1.5 text-xs">
                <Terminal className="size-3.5" />
                TypeScript / Node
              </TabsTrigger>
              <TabsTrigger value="drizzle" className="gap-1.5 text-xs">
                <Layers className="size-3.5" />
                Drizzle ORM
              </TabsTrigger>
              <TabsTrigger value="python" className="gap-1.5 text-xs">
                Python
              </TabsTrigger>
              <TabsTrigger value="curl" className="gap-1.5 text-xs">
                cURL
              </TabsTrigger>
              <TabsTrigger value="env" className="gap-1.5 text-xs">
                .env
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ts" className="mt-3">
              <CodeSnippet code={tsCode} />
            </TabsContent>
            <TabsContent value="drizzle" className="mt-3">
              <CodeSnippet code={drizzleCode} />
            </TabsContent>
            <TabsContent value="python" className="mt-3">
              <CodeSnippet code={pythonCode} />
            </TabsContent>
            <TabsContent value="curl" className="mt-3">
              <CodeSnippet code={curlCode} />
            </TabsContent>
            <TabsContent value="env" className="mt-3">
              <CodeSnippet code={envCode} />
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
