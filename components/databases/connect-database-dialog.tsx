"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { Copy, Check, Terminal, Code2, Layers, KeyRound, Globe } from "lucide-react";
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
    <Box
      sx={{
        position: "relative",
        borderRadius: "10px",
        border: "1px solid var(--border)",
        backgroundColor: "#09090b",
        p: 2,
        fontFamily: "var(--font-mono)",
        fontSize: "0.75rem",
        color: "#f4f4f5",
      }}
    >
      <IconButton
        type="button"
        size="small"
        onClick={handleCopy}
        aria-label="Copy code snippet"
        sx={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 28,
          height: 28,
          color: "#a1a1aa",
          "&:hover": {
            color: "#f4f4f5",
            backgroundColor: "#27272a",
          },
        }}
      >
        {copied ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
      </IconButton>
      <Box
        component="pre"
        sx={{
          m: 0,
          overflowX: "auto",
          pr: 4,
          lineHeight: 1.6,
          whiteSpace: "pre",
          fontFamily: "var(--font-mono)",
        }}
      >
        {code}
      </Box>
    </Box>
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
  const [tab, setTab] = React.useState<"ts" | "drizzle" | "python" | "curl" | "env">("ts");

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

  const activeCode =
    tab === "ts"
      ? tsCode
      : tab === "drizzle"
        ? drizzleCode
        : tab === "python"
          ? pythonCode
          : tab === "curl"
            ? curlCode
            : envCode;

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} fullWidth maxWidth="md">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              display: "inline-flex",
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              backgroundColor: "rgba(56, 189, 248, 0.12)",
              color: "var(--primary)",
            }}
          >
            <Code2 size={20} />
          </Box>
          <Box>
            <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
              Connect to {database.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Namespace:{" "}
              <Box component="span" sx={{ fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>
                {database.namespace}
              </Box>
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: "10px",
            backgroundColor: "var(--muted)",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <Globe size={14} /> LibSQL Connection URL
            </Typography>
            <CopyField
              value={url}
              sx={{
                borderRadius: "6px",
                backgroundColor: "var(--background)",
                px: 1.25,
                py: 0.75,
                border: "1px solid var(--border)",
              }}
            />
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 0.75 }}
            >
              <KeyRound size={14} /> Primary Auth Token
            </Typography>
            <CopyField
              value={token}
              sx={{
                borderRadius: "6px",
                backgroundColor: "var(--background)",
                px: 1.25,
                py: 0.75,
                border: "1px solid var(--border)",
              }}
            />
          </Box>
        </Paper>

        <Box>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: "1px solid var(--border)", mb: 2 }}
          >
            <Tab
              value="ts"
              icon={<Terminal size={14} />}
              iconPosition="start"
              label="TypeScript / Node"
              sx={{ minHeight: 40, fontSize: "0.75rem" }}
            />
            <Tab
              value="drizzle"
              icon={<Layers size={14} />}
              iconPosition="start"
              label="Drizzle ORM"
              sx={{ minHeight: 40, fontSize: "0.75rem" }}
            />
            <Tab
              value="python"
              label="Python"
              sx={{ minHeight: 40, fontSize: "0.75rem" }}
            />
            <Tab
              value="curl"
              label="cURL"
              sx={{ minHeight: 40, fontSize: "0.75rem" }}
            />
            <Tab
              value="env"
              label=".env"
              sx={{ minHeight: 40, fontSize: "0.75rem" }}
            />
          </Tabs>

          <CodeSnippet code={activeCode} />
        </Box>
      </DialogContent>
    </Dialog>
  );
}
