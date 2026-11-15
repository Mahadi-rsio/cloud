"use client";

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Check,
  Code2,
  Copy,
  Database,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  MoreHorizontal,
  Plug,
  Plus,
  Settings as SettingsIcon,
  Table2,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CopyField } from "@/components/shared/copy-field";
import { EmptyState, ErrorState } from "@/components/shared/empty-state";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { ToneBadge } from "@/components/shared/surface-card";
import { UsageBar } from "@/components/shared/usage-bar";
import { StudioLoader } from "@/components/studio/StudioLoader";
import { deleteDatabase, getDatabase, type DatabaseItem } from "@/lib/databases/client";
import { extractErrorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/storage-client";

const FREE_PLAN_LIMITS = {
  rowsRead: 1_000_000,
  rowsWritten: 100_000,
  storageBytes: 512 * 1024 * 1024,
};

type DbTab = "overview" | "studio" | "connection" | "settings" | "usage" | "metrics";

const VALID_TABS: DbTab[] = ["overview", "studio", "connection", "settings", "usage", "metrics"];

interface DatabaseTokenItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  preview: string;
}

function getDbStatusLabel(status: DatabaseItem["status"]): string {
  if (status === "provisioning") return "Creating";
  if (status === "failed") return "Error";
  if (status === "ready") return "Ready";
  return status;
}

function CodeBlock({ code }: { code: string }) {
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
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: "10px",
        border: "1px solid var(--border)",
        backgroundColor: "#090d11",
        p: 2,
        fontFamily: "var(--font-mono)",
        fontSize: "0.78rem",
        color: "#e8eff2",
      }}
    >
      <Tooltip title={copied ? "Copied" : "Copy snippet"}>
        <IconButton
          size="small"
          aria-label="Copy code snippet"
          onClick={() => void handleCopy()}
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            color: copied ? "var(--success)" : "#94a3b8",
            "&:hover": { color: "#e8eff2", backgroundColor: "rgba(255,255,255,0.08)" },
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </Tooltip>
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

export function DatabaseDetailPage({ databaseId }: { databaseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get("tab") as DbTab | null;
  const activeTab: DbTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : "overview";

  const setActiveTab = React.useCallback(
    (tab: DbTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "overview") {
        params.delete("tab");
      } else {
        params.set("tab", tab);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [db, setDb] = React.useState<DatabaseItem | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // Connection tab state
  const [snippetTab, setSnippetTab] = React.useState<"node" | "drizzle" | "python" | "curl">("node");
  const [revealDefaultToken, setRevealDefaultToken] = React.useState(false);
  const [newTokenName, setNewTokenName] = React.useState("");
  const [tokens, setTokens] = React.useState<DatabaseTokenItem[]>([]);
  const [createdTokenSecret, setCreatedTokenSecret] = React.useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<DatabaseTokenItem | null>(null);

  // Settings tab state
  const [renameValue, setRenameValue] = React.useState("");
  const [isRenaming, setIsRenaming] = React.useState(false);

  // Usage & Metrics range state
  const [usagePeriod, setUsagePeriod] = React.useState<"24h" | "7d" | "30d">("7d");
  const [metricsRange, setMetricsRange] = React.useState<"1h" | "24h" | "7d" | "30d">("24h");

  const loadDatabase = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getDatabase(databaseId);
      setDb(data);
      setRenameValue(data.name);
      // Seed default token entry for display until /api/v1/databases/[id]/tokens exists
      setTokens([
        {
          id: "default",
          name: "Default full-access token",
          createdAt: data.createdAt,
          lastUsedAt: null,
          preview: `${data.defaultToken.slice(0, 12)}...${data.defaultToken.slice(-6)}`,
        },
      ]);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [databaseId]);

  React.useEffect(() => {
    void loadDatabase();
  }, [loadDatabase]);

  const handleCopy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setToast(message);
  };

  const handleDeleteDatabase = async () => {
    if (!db) return;
    try {
      setIsDeleting(true);
      await deleteDatabase(db.id);
      router.push("/databases");
    } catch (err) {
      setToast(extractErrorMessage(err));
      setIsDeleting(false);
    }
  };

  const handleCreateToken = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newTokenName.trim();
    if (!clean || !db) return;
    // TODO: Wire to POST /api/v1/databases/[id]/tokens when token management API is added
    const stubSecret = db.defaultToken;
    setTokens((prev) => [
      {
        id: `tok_${Date.now()}`,
        name: clean,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        preview: `${stubSecret.slice(0, 12)}...${stubSecret.slice(-6)}`,
      },
      ...prev,
    ]);
    setCreatedTokenSecret(stubSecret);
    setNewTokenName("");
    setToast("Auth token created (copy it now)");
  };

  const handleRevokeToken = () => {
    if (!revokeTarget) return;
    // TODO: Wire to DELETE /api/v1/databases/[id]/tokens/[tokenId]
    setTokens((prev) => prev.filter((t) => t.id !== revokeTarget.id));
    setToast(`Revoked token "${revokeTarget.name}"`);
    setRevokeTarget(null);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = renameValue.trim();
    if (!clean || !db || clean === db.name) return;
    setIsRenaming(true);
    // TODO: Wire to PATCH /api/v1/databases/[id] when database rename endpoint is added
    setTimeout(() => {
      setIsRenaming(false);
      setToast("Database rename API is not enabled yet (stubbed)");
    }, 300);
  };

  if (isLoading) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        <Skeleton variant="rounded" height={56} sx={{ borderRadius: "10px" }} />
        <Skeleton variant="rounded" height={42} sx={{ borderRadius: "10px" }} />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(5, 1fr)" },
            gap: 2,
          }}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: "12px" }} />
          ))}
        </Box>
      </Box>
    );
  }

  if (error || !db) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Button
          startIcon={<ArrowLeft size={16} />}
          onClick={() => router.push("/databases")}
          sx={{ alignSelf: "flex-start" }}
        >
          Back to databases
        </Button>
        <ErrorState
          title="Unable to load database"
          description={error ?? "Database not found."}
          onRetry={() => void loadDatabase()}
        />
      </Box>
    );
  }

  const rowsRead = db.stats?.rowsReadCount ?? 0;
  const rowsWritten = db.stats?.rowsWrittenCount ?? 0;
  const storageBytes = db.stats?.storageBytesUsed ?? 0;

  const readPercent = Math.min(100, (rowsRead / FREE_PLAN_LIMITS.rowsRead) * 100);
  const writePercent = Math.min(100, (rowsWritten / FREE_PLAN_LIMITS.rowsWritten) * 100);
  const storagePercent = Math.min(100, (storageBytes / FREE_PLAN_LIMITS.storageBytes) * 100);

  const nodeSnippet = `import { createClient } from "@libsql/client";

export const db = createClient({
  url: "${db.libsqlUrl}",
  authToken: process.env.DATABASE_AUTH_TOKEN!,
});

const res = await db.execute("SELECT 1 AS ok;");
console.log(res.rows);`;

  const drizzleSnippet = `import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

const client = createClient({
  url: "${db.libsqlUrl}",
  authToken: process.env.DATABASE_AUTH_TOKEN!,
});

export const db = drizzle(client);`;

  const pythonSnippet = `import os
import libsql_client

client = libsql_client.create_client_sync(
    url="${db.libsqlUrl}",
    auth_token=os.environ["DATABASE_AUTH_TOKEN"],
)

res = client.execute("SELECT 1 AS ok;")
print(res.rows)`;

  const curlSnippet = `curl -X POST "${db.httpUrl}/v2/pipeline" \\
  -H "Authorization: Bearer $DATABASE_AUTH_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT 1;"}}]}'`;

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2.5,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
      }}
    >
      {/* Single Sticky Header + Tabs */}
      <Box
        sx={{
          position: "sticky",
          top: "var(--appbar-h, 56px)",
          zIndex: 10,
          backgroundColor: "var(--background)",
          borderBottom: "1px solid var(--border)",
          mx: { xs: -2, sm: -3, md: -4 },
          px: { xs: 2, sm: 3, md: 4 },
          pt: 0.5,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 1.25,
            pb: 1.25,
            minWidth: 0,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, flex: 1 }}>
            <Tooltip title="Back to databases">
              <IconButton
                aria-label="Back to databases"
                onClick={() => router.push("/databases")}
                sx={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                  flexShrink: 0,
                }}
              >
                <ArrowLeft size={16} />
              </IconButton>
            </Tooltip>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.875,
                minWidth: 0,
                flex: 1,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="h5"
                component="h1"
                noWrap
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: "1.15rem", sm: "1.4rem" },
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                {db.name}
              </Typography>
              <StatusBadge status={db.status} label={getDbStatusLabel(db.status)} />
              <Chip
                size="small"
                label={db.region.toUpperCase()}
                sx={{
                  height: 22,
                  fontSize: "0.7rem",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  borderRadius: "6px",
                }}
              />
            </Box>
          </Box>

          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              justifyContent: { xs: "flex-start", sm: "flex-end" },
              flexShrink: 0,
            }}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={<Copy size={14} />}
              onClick={() => void handleCopy(db.libsqlUrl, "Connection URL copied")}
              sx={{ minHeight: 36, borderRadius: "9px" }}
            >
              Copy URL
            </Button>
            <Tooltip title="More actions">
              <IconButton
                aria-label="More database actions"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{
                  width: 36,
                  height: 36,
                  border: "1px solid var(--border)",
                  borderRadius: "9px",
                }}
              >
                <MoreHorizontal size={16} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        <Tabs
          value={activeTab}
          onChange={(_, val: DbTab) => setActiveTab(val)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Database sections"
          sx={{
            minHeight: 42,
            maxWidth: "100%",
            "& .MuiTab-root": {
              minHeight: 42,
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.85rem",
              px: 1.5,
            },
          }}
        >
          <Tab value="overview" label="Overview" />
          <Tab value="studio" label="Studio" />
          <Tab value="connection" label="Connection" />
          <Tab value="settings" label="Settings" />
          <Tab value="usage" label="Usage" />
          <Tab value="metrics" label="Metrics" />
        </Tabs>
      </Box>

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0, width: "100%" }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, minmax(0, 1fr))",
                md: "repeat(3, minmax(0, 1fr))",
                lg: "repeat(5, minmax(0, 1fr))",
              },
              gap: 1.5,
              minWidth: 0,
            }}
          >
            <StatCard
              label="Status"
              value={<StatusBadge status={db.status} label={getDbStatusLabel(db.status)} />}
            />
            <StatCard label="Region" value={db.region.toUpperCase()} mono />
            <StatCard
              label="Created"
              value={<RelativeTime value={db.createdAt} />}
              subtext={new Date(db.createdAt).toLocaleDateString()}
            />
            <StatCard
              label="Database ID"
              value={
                <CopyField
                  value={db.id}
                  display={`${db.id.slice(0, 8)}...`}
                  label="Copy database ID"
                />
              }
              mono
            />
            <StatCard
              label="Size"
              value={formatBytes(storageBytes)}
              icon={<HardDrive size={14} />}
              sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}
            />
          </Box>

          {/* Connection URL + Quick Actions */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" },
              gap: 2,
              minWidth: 0,
            }}
          >
            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: "12px",
                borderColor: "var(--border)",
                backgroundColor: "var(--card)",
                display: "flex",
                flexDirection: "column",
                gap: 1.75,
                minWidth: 0,
                maxWidth: "100%",
                overflow: "hidden",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Connection endpoints
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  libSQL URL
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    minWidth: 0,
                    width: "100%",
                    overflow: "hidden",
                    px: 1.5,
                    py: 1,
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--muted)",
                  }}
                >
                  <CopyField value={db.libsqlUrl} sx={{ width: "100%", minWidth: 0 }} />
                </Box>
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  HTTP URL
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    minWidth: 0,
                    width: "100%",
                    overflow: "hidden",
                    px: 1.5,
                    py: 1,
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--muted)",
                  }}
                >
                  <CopyField value={db.httpUrl} sx={{ width: "100%", minWidth: 0 }} />
                </Box>
              </Box>
            </Paper>

            <Paper
              variant="outlined"
              sx={{
                p: 2.5,
                borderRadius: "12px",
                borderColor: "var(--border)",
                backgroundColor: "var(--card)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 1.5,
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Quick actions
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row", lg: "column" },
                  flexWrap: "wrap",
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Button
                  variant="contained"
                  startIcon={<Table2 size={16} />}
                  onClick={() => setActiveTab("studio")}
                  sx={{
                    width: { xs: "100%", sm: "auto", lg: "100%" },
                    flex: { sm: "1 1 0%", lg: "0 0 auto" },
                    justifyContent: "flex-start",
                  }}
                >
                  Open Studio
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<KeyRound size={16} />}
                  onClick={() => setActiveTab("connection")}
                  sx={{
                    width: { xs: "100%", sm: "auto", lg: "100%" },
                    flex: { sm: "1 1 0%", lg: "0 0 auto" },
                    justifyContent: "flex-start",
                  }}
                >
                  Create token
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<Plug size={16} />}
                  onClick={() => setActiveTab("connection")}
                  sx={{
                    width: { xs: "100%", sm: "auto", lg: "100%" },
                    flex: { sm: "1 1 0%", lg: "0 0 auto" },
                    justifyContent: "flex-start",
                  }}
                >
                  Connect
                </Button>
              </Box>
            </Paper>
          </Box>

          {/* Usage snapshot */}
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 0,
              maxWidth: "100%",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Usage snapshot
              </Typography>
              <ToneBadge tone="primary">Free tier</ToneBadge>
            </Box>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" },
                gap: 2.5,
                minWidth: 0,
              }}
            >
              <UsageBar
                label="Rows read"
                valueLabel={`${rowsRead.toLocaleString()} / ${FREE_PLAN_LIMITS.rowsRead.toLocaleString()}`}
                percent={readPercent}
              />
              <UsageBar
                label="Rows written"
                valueLabel={`${rowsWritten.toLocaleString()} / ${FREE_PLAN_LIMITS.rowsWritten.toLocaleString()}`}
                percent={writePercent}
              />
            </Box>
          </Paper>
        </Box>
      )}

      {/* Tab 2: Studio */}
      {activeTab === "studio" && (
        <Box
          sx={{
            width: "100%",
            minWidth: 0,
            overflow: "hidden",
            height: {
              xs: "calc(100dvh - var(--appbar-h, 56px) - 160px - var(--bottomnav-h, 60px) - env(safe-area-inset-bottom, 0px))",
              sm: "calc(100dvh - var(--appbar-h, 60px) - 140px)",
            },
            minHeight: 460,
          }}
        >
          <StudioLoader embedded databaseId={db.id} databaseName={db.name} />
        </Box>
      )}

      {/* Tab 3: Connection */}
      {activeTab === "connection" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0, width: "100%" }}>
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Connection URL
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                minWidth: 0,
                width: "100%",
                overflow: "hidden",
                px: 1.5,
                py: 1,
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--muted)",
              }}
            >
              <CopyField value={db.libsqlUrl} sx={{ width: "100%", minWidth: 0 }} />
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                minWidth: 0,
                width: "100%",
                overflow: "hidden",
                px: 1.5,
                py: 1,
                borderRadius: "8px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--muted)",
              }}
            >
              <Typography
                variant="caption"
                noWrap
                sx={{ fontFamily: "var(--font-mono)", flex: 1, minWidth: 0 }}
              >
                {revealDefaultToken
                  ? db.defaultToken
                  : `${db.defaultToken.slice(0, 14)}••••••••••••••••${db.defaultToken.slice(-6)}`}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title={revealDefaultToken ? "Hide token" : "Reveal token"}>
                  <IconButton
                    size="small"
                    aria-label="Toggle default token visibility"
                    onClick={() => setRevealDefaultToken((v) => !v)}
                  >
                    {revealDefaultToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Copy default token">
                  <IconButton
                    size="small"
                    aria-label="Copy default token"
                    onClick={() => void handleCopy(db.defaultToken, "Auth token copied")}
                  >
                    <Copy size={14} />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          </Paper>

          {/* Auth Token Management */}
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "stretch", sm: "center" },
                justifyContent: "space-between",
                gap: 1.5,
                minWidth: 0,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Auth tokens
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  Create scoped tokens for your applications and CI pipelines.
                </Typography>
              </Box>
              <Box
                component="form"
                onSubmit={handleCreateToken}
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row" },
                  gap: 1,
                  alignItems: { xs: "stretch", sm: "center" },
                  minWidth: 0,
                }}
              >
                <TextField
                  size="small"
                  placeholder="Token name (e.g. prod-api)"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  sx={{ minWidth: { xs: 0, sm: 220 }, flex: 1 }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="small"
                  startIcon={<Plus size={14} />}
                  disabled={!newTokenName.trim()}
                  sx={{ minHeight: 38, flexShrink: 0 }}
                >
                  Create token
                </Button>
              </Box>
            </Box>

            {createdTokenSecret && (
              <Alert
                severity="success"
                onClose={() => setCreatedTokenSecret(null)}
                sx={{ alignItems: "center" }}
              >
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    Copy your new auth token now — you will not be able to see it again.
                  </Typography>
                  <CopyField value={createdTokenSecret} />
                </Box>
              </Alert>
            )}

            <TableContainer sx={{ maxWidth: "100%", overflowX: "auto" }}>
              <Table size="small" aria-label="Database auth tokens">
                <TableHead>
                  <TableRow
                    sx={{
                      "& th": {
                        color: "var(--muted-foreground)",
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        borderBottomColor: "var(--border)",
                      },
                    }}
                  >
                    <TableCell>Name</TableCell>
                    <TableCell>Token</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Last used</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tokens.map((tok) => (
                    <TableRow
                      key={tok.id}
                      sx={{
                        "& td": { borderBottomColor: "var(--border)" },
                        "&:last-child td": { borderBottom: 0 },
                      }}
                    >
                      <TableCell sx={{ fontWeight: 500 }}>{tok.name}</TableCell>
                      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                        {tok.preview}
                      </TableCell>
                      <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.8rem" }}>
                        <RelativeTime value={tok.createdAt} />
                      </TableCell>
                      <TableCell sx={{ color: "var(--muted-foreground)", fontSize: "0.8rem" }}>
                        {tok.lastUsedAt ? <RelativeTime value={tok.lastUsedAt} /> : "Never"}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
                          disabled={tok.id === "default"}
                          onClick={() => setRevokeTarget(tok)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Code Snippets */}
          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              minWidth: 0,
              maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Code2 size={16} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                Connect with SDK
              </Typography>
            </Box>
            <Tabs
              value={snippetTab}
              onChange={(_, v) => setSnippetTab(v)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                borderBottom: "1px solid var(--border)",
                minHeight: 38,
                "& .MuiTab-root": { minHeight: 38, textTransform: "none", fontSize: "0.8rem" },
              }}
            >
              <Tab value="node" label="Node / libSQL" />
              <Tab value="drizzle" label="Drizzle" />
              <Tab value="python" label="Python" />
              <Tab value="curl" label="CLI / curl" />
            </Tabs>
            {snippetTab === "node" && <CodeBlock code={nodeSnippet} />}
            {snippetTab === "drizzle" && <CodeBlock code={drizzleSnippet} />}
            {snippetTab === "python" && <CodeBlock code={pythonSnippet} />}
            {snippetTab === "curl" && <CodeBlock code={curlSnippet} />}
          </Paper>
        </Box>
      )}

      {/* Tab 4: Settings */}
      {activeTab === "settings" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, maxWidth: 680 }}>
          <Paper
            component="form"
            onSubmit={handleRenameSubmit}
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <SettingsIcon size={16} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                General
              </Typography>
            </Box>
            <TextField
              label="Database name"
              size="small"
              fullWidth
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
            <TextField
              label="Region"
              size="small"
              fullWidth
              value={`${db.region.toUpperCase()} (US East)`}
              slotProps={{ input: { readOnly: true } }}
              helperText="Primary region cannot be changed after creation."
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                type="submit"
                variant="contained"
                disabled={isRenaming || !renameValue.trim() || renameValue.trim() === db.name}
              >
                {isRenaming ? "Saving..." : "Save changes"}
              </Button>
            </Box>
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "rgba(229, 72, 77, 0.35)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              alignItems: { xs: "flex-start", sm: "center" },
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "var(--destructive)" }}>
                Danger zone
              </Typography>
              <Typography variant="body2" sx={{ color: "var(--muted-foreground)", mt: 0.25 }}>
                Permanently delete <strong>{db.name}</strong> and all tables, rows, and tokens.
              </Typography>
            </Box>
            <Button
              variant="contained"
              color="error"
              startIcon={<Trash2 size={15} />}
              onClick={() => setDeleteOpen(true)}
              sx={{ flexShrink: 0 }}
            >
              Delete database
            </Button>
          </Paper>
        </Box>
      )}

      {/* Tab 5: Usage */}
      {activeTab === "usage" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5, minWidth: 0, width: "100%" }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
              gap: 2,
              minWidth: 0,
            }}
          >
            <StatCard
              label="Rows read"
              value={rowsRead.toLocaleString()}
              subtext={
                <UsageBar
                  compact
                  valueLabel={`${readPercent.toFixed(1)}% of 1M`}
                  percent={readPercent}
                  sx={{ mt: 1 }}
                />
              }
            />
            <StatCard
              label="Rows written"
              value={rowsWritten.toLocaleString()}
              subtext={
                <UsageBar
                  compact
                  valueLabel={`${writePercent.toFixed(1)}% of 100K`}
                  percent={writePercent}
                  sx={{ mt: 1 }}
                />
              }
            />
            <StatCard
              label="Storage used"
              value={formatBytes(storageBytes)}
              subtext={
                <UsageBar
                  compact
                  valueLabel={`${storagePercent.toFixed(1)}% of 512 MB`}
                  percent={storagePercent}
                  sx={{ mt: 1 }}
                />
              }
            />
          </Box>

          <Paper
            variant="outlined"
            sx={{
              p: 2.5,
              borderRadius: "12px",
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { xs: "flex-start", sm: "center" },
                justifyContent: "space-between",
                gap: 1.5,
              }}
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  Usage over time
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                  Row reads, writes, and storage growth for the selected window.
                </Typography>
              </Box>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={usagePeriod}
                onChange={(_, v) => v && setUsagePeriod(v)}
              >
                <ToggleButton value="24h">24h</ToggleButton>
                <ToggleButton value="7d">7d</ToggleButton>
                <ToggleButton value="30d">30d</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            {/* TODO: Fetch time-series usage data from /api/v1/databases/[id]/usage */}
            <EmptyState
              icon={<BarChart3 size={20} />}
              title={`No ${usagePeriod} time-series usage yet`}
              description="Historical usage breakdowns will appear here once queries run across multiple intervals."
              sx={{ py: 4 }}
            />
          </Paper>

          <Alert
            severity="info"
            action={
              <Button color="inherit" size="small" onClick={() => router.push("/billing")}>
                View plans
              </Button>
            }
          >
            You are on the <strong>Free tier</strong> (1M rows read, 100K rows written, 512 MB storage per database).
          </Alert>
        </Box>
      )}

      {/* Tab 6: Metrics */}
      {activeTab === "metrics" && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Performance & query metrics
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={metricsRange}
              onChange={(_, v) => v && setMetricsRange(v)}
            >
              <ToggleButton value="1h">1h</ToggleButton>
              <ToggleButton value="24h">24h</ToggleButton>
              <ToggleButton value="7d">7d</ToggleButton>
              <ToggleButton value="30d">30d</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* TODO: Fetch from /api/v1/databases/[id]/metrics?range=${metricsRange} */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" },
              gap: 2,
              minWidth: 0,
            }}
          >
            {[
              { title: "Queries over time", subtitle: `Total requests (${metricsRange})` },
              { title: "Latency (p50 / p95)", subtitle: `Response time in ms (${metricsRange})` },
              { title: "Errors", subtitle: `Failed queries & timeouts (${metricsRange})` },
              { title: "Rows read / written", subtitle: `Throughput over time (${metricsRange})` },
            ].map((chart) => (
              <Paper
                key={chart.title}
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: "12px",
                  borderColor: "var(--border)",
                  backgroundColor: "var(--card)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {chart.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "var(--muted-foreground)" }}>
                    {chart.subtitle}
                  </Typography>
                </Box>
                <EmptyState
                  icon={<Activity size={18} />}
                  title="No metrics data yet"
                  description="Metrics populate automatically once your database handles traffic."
                  sx={{ py: 4 }}
                />
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* Header Overflow Menu */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setActiveTab("studio");
          }}
        >
          <ListItemIcon>
            <Table2 size={16} />
          </ListItemIcon>
          Open Studio
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void handleCopy(db.httpUrl, "HTTP URL copied");
          }}
        >
          <ListItemIcon>
            <Copy size={16} />
          </ListItemIcon>
          Copy HTTP URL
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setDeleteOpen(true);
          }}
          sx={{ color: "var(--destructive)" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <Trash2 size={16} />
          </ListItemIcon>
          Delete database
        </MenuItem>
      </Menu>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete database"
        description={
          <>
            This permanently deletes <strong>{db.name}</strong> and all of its data.
            This action cannot be undone.
          </>
        }
        confirmText={db.name}
        confirmLabel="Delete database"
        isPending={isDeleting}
        onConfirm={() => void handleDeleteDatabase()}
      />

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke auth token"
        description={
          <>
            Applications using <strong>{revokeTarget?.name}</strong> will immediately lose
            access to this database.
          </>
        }
        confirmLabel="Revoke token"
        onConfirm={handleRevokeToken}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={2500}
        onClose={() => setToast(null)}
        message={toast}
      />
    </Box>
  );
}
