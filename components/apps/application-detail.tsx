"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCw,
  Settings2,
  Terminal,
  Trash2,
} from "lucide-react";
import {
  deleteApplication,
  getApplication,
  updateApplication,
  type Application,
  type Machine,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { appUrl } from "@/lib/site";
import type { RuntimeInput } from "@/lib/validators/application";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyField } from "@/components/shared/copy-field";
import { DataList } from "@/components/shared/data-list";
import { ErrorState } from "@/components/shared/empty-state";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { ComingSoonDialog } from "@/components/shared/coming-soon";
import {
  formatDate,
  formatGuestSize,
  regionName,
  shortImageName,
} from "@/components/apps/format";
import { EditApplicationDialog } from "./edit-application-dialog";
import { MachineLogsViewer } from "./machine-logs-viewer";

type AppTab = "overview" | "logs" | "env" | "metrics" | "settings";

const TABS: { id: AppTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "logs", label: "Logs" },
  { id: "env", label: "Env vars" },
  { id: "metrics", label: "Metrics" },
  { id: "settings", label: "Settings" },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "var(--foreground)" }}>
      {children}
    </Typography>
  );
}

function OverviewTab({
  application,
  machines,
  onViewLogs,
}: {
  application: Application;
  machines: Machine[];
  onViewLogs: () => void;
}) {
  const machine = machines[0];
  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <SectionTitle>Runtime</SectionTitle>
        <DataList
          items={[
            {
              label: "Image",
              value: (
                <Typography
                  component="span"
                  variant="body2"
                  noWrap
                  title={application.runtime?.image}
                  sx={{ display: "block", fontFamily: "var(--font-mono)" }}
                >
                  {shortImageName(application.runtime?.image)}
                </Typography>
              ),
            },
            {
              label: "Size",
              value: formatGuestSize(application.runtime?.guest),
            },
            { label: "Region", value: regionName(application.region) },
            {
              label: "Port",
              value: application.runtime?.internalPort
                ? String(application.runtime.internalPort)
                : "—",
            },
          ]}
        />
      </Stack>

      <Stack spacing={1}>
        <SectionTitle>Deployment</SectionTitle>
        <DataList
          items={[
            { label: "Created", value: formatDate(application.createdAt) },
            { label: "Last updated", value: formatDate(application.updatedAt) },
            {
              label: "Last operation",
              value: formatDate(application.lastOperationAt),
            },
          ]}
        />
      </Stack>

      {machine && (
        <Stack spacing={1}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <SectionTitle>Machine</SectionTitle>
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={onViewLogs}
              startIcon={<Terminal size={14} />}
              sx={{ fontSize: "0.75rem" }}
            >
              View machine logs
            </Button>
          </Box>
          <DataList
            items={[
              {
                label: "Machine ID",
                value: machine.flyMachineId ? (
                  <CopyField value={machine.flyMachineId} />
                ) : (
                  "—"
                ),
              },
              {
                label: "Status",
                value: <StatusBadge status={machine.status} />,
              },
              {
                label: "Instance",
                value: `Instance ${machine.instanceNumber + 1}`,
              },
              {
                label: "IPv4",
                value: machine.sharedIpv4 ? (
                  <CopyField value={machine.sharedIpv4} />
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </Stack>
      )}
    </Stack>
  );
}

function EnvVarsTab({
  application,
  onUpdated,
}: {
  application: Application;
  onUpdated: (application: Application) => void;
}) {
  const initial = application.runtime?.env ?? {};
  const [entries, setEntries] = useState<[string, string][]>(() =>
    Object.entries(initial)
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: Record<string, string>) => {
    setIsSaving(true);
    setError(null);
    try {
      const { application: updated } = await updateApplication(
        application.id,
        {
          runtime: {
            ...(application.runtime ?? {}),
            env: next,
          } as RuntimeInput,
        }
      );
      onUpdated(updated);
    } catch (saveError) {
      setError(extractErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const add = () => {
    const key = newKey.trim();
    if (!key) return;
    if (entries.some(([existing]) => existing === key)) {
      setError(`Variable ${key} already exists.`);
      return;
    }
    const next = Object.fromEntries([...entries, [key, newValue]]);
    setEntries([...entries, [key, newValue]]);
    setNewKey("");
    setNewValue("");
    void save(next);
  };

  const remove = (key: string) => {
    const next = Object.fromEntries(entries.filter(([existing]) => existing !== key));
    setEntries(entries.filter(([existing]) => existing !== key));
    setRevealed((current) => {
      const copy = new Set(current);
      copy.delete(key);
      return copy;
    });
    void save(next);
  };

  return (
    <Stack spacing={2}>
      <Card
        sx={{
          p: 2,
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "flex-end" },
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 1.5,
          }}
        >
          <TextField
            id="env-key"
            label="Key"
            size="small"
            value={newKey}
            onChange={(event) => setNewKey(event.target.value)}
            placeholder="DATABASE_URL"
            autoComplete="off"
            slotProps={{
              htmlInput: {
                spellCheck: false,
                style: { fontFamily: "var(--font-mono)" },
              },
            }}
          />
          <TextField
            id="env-value"
            label="Value"
            size="small"
            value={newValue}
            onChange={(event) => setNewValue(event.target.value)}
            placeholder="postgres://…"
            autoComplete="off"
            slotProps={{
              htmlInput: {
                spellCheck: false,
                style: { fontFamily: "var(--font-mono)" },
              },
            }}
          />
        </Box>
        <Button
          type="button"
          variant="contained"
          onClick={add}
          disabled={isSaving || !newKey.trim()}
          startIcon={<Plus size={16} />}
        >
          Add
        </Button>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      {entries.length === 0 ? (
        <Box
          sx={{
            borderRadius: "12px",
            border: "1px dashed var(--border)",
            px: 3,
            py: 5,
            textAlign: "center",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No environment variables yet. Add one above.
          </Typography>
        </Box>
      ) : (
        <Card sx={{ overflow: "hidden" }}>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {entries.map(([key, value], index) => {
              const isRevealed = revealed.has(key);
              return (
                <React.Fragment key={key}>
                  {index > 0 && <Divider />}
                  <Box
                    component="li"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      px: 2,
                      py: 1.5,
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: "var(--font-mono)",
                        color: "var(--foreground)",
                      }}
                    >
                      {key}
                    </Typography>
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        fontFamily: "var(--font-mono)",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {isRevealed ? value : "••••••••"}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={isRevealed ? `Hide ${key}` : `Reveal ${key}`}
                      onClick={() =>
                        setRevealed((current) => {
                          const copy = new Set(current);
                          if (isRevealed) copy.delete(key);
                          else copy.add(key);
                          return copy;
                        })
                      }
                      sx={{ flexShrink: 0, color: "var(--muted-foreground)" }}
                    >
                      {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Delete ${key}`}
                      onClick={() => remove(key)}
                      sx={{ flexShrink: 0, color: "var(--muted-foreground)" }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        </Card>
      )}
    </Stack>
  );
}

function MetricsTab() {
  return (
    <Box
      sx={{
        borderRadius: "12px",
        border: "1px dashed var(--border)",
        px: 3,
        py: 7,
        textAlign: "center",
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        Metrics are coming soon
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mx: "auto", mt: 0.5, maxWidth: 380 }}
      >
        CPU, memory and request graphs for this app will appear here.
      </Typography>
    </Box>
  );
}

function SettingsTab({
  application,
  onUpdated,
  onDelete,
}: {
  application: Application;
  onUpdated: (application: Application) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(application.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const rename = async () => {
    setIsRenaming(true);
    setRenameError(null);
    try {
      const { application: updated } = await updateApplication(application.id, {
        name: name.trim(),
      });
      onUpdated(updated);
    } catch (err) {
      setRenameError(extractErrorMessage(err));
    } finally {
      setIsRenaming(false);
    }
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteApplication(application.id);
      onDelete();
    } catch (deleteError) {
      setRenameError(extractErrorMessage(deleteError));
      setDeleteOpen(false);
      setIsDeleting(false);
    }
  };

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <SectionTitle>General</SectionTitle>
        <Card sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
          <TextField
            id="app-name"
            label="App name"
            size="small"
            fullWidth
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            slotProps={{ htmlInput: { spellCheck: false } }}
            helperText="The name is used to build the public URL. The slug cannot be changed."
          />
          {renameError && <Alert severity="error">{renameError}</Alert>}
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="button"
              variant="contained"
              onClick={() => void rename()}
              disabled={isRenaming || !name.trim() || name.trim() === application.name}
            >
              {isRenaming ? "Saving…" : "Save"}
            </Button>
          </Box>
        </Card>
      </Stack>

      <Stack spacing={1}>
        <SectionTitle>Danger zone</SectionTitle>
        <Card
          sx={{
            p: 2.5,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            borderColor: "rgba(239, 68, 68, 0.3)",
            backgroundColor: "rgba(239, 68, 68, 0.04)",
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Delete this app
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Permanently deletes the app and its machine. The public URL will
              stop working immediately. This cannot be undone.
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="button"
              variant="contained"
              color="error"
              onClick={() => setDeleteOpen(true)}
              startIcon={<Trash2 size={16} />}
            >
              Delete app
            </Button>
          </Box>
        </Card>
      </Stack>

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${application.name}?`}
        description={
          <>
            This permanently deletes the app and its machine. The public URL
            will stop working immediately. This cannot be undone.
          </>
        }
        confirmText={application.name}
        isPending={isDeleting}
        onConfirm={() => void confirmDelete()}
      />
    </Stack>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<{
    application: Application;
    machines: Machine[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<AppTab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [redeployOpen, setRedeployOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const load = async () => {
    try {
      setError(null);
      setIsLoading(true);
      setData(await getApplication(id));
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    const read = () => {
      const raw = window.location.hash.replace(/^#/, "");
      const match = TABS.find((t) => t.id === raw);
      setTab(match ? match.id : "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const selectTab = (next: AppTab) => {
    setTab(next);
    window.location.hash = next;
  };

  const application = data?.application;
  const machines = data?.machines ?? [];

  return (
    <Box sx={{ mx: "auto", width: "100%", maxWidth: 896, display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Button
          component="a"
          href="/apps"
          variant="text"
          size="small"
          startIcon={<ArrowLeft size={16} />}
          sx={{
            px: 0,
            color: "var(--muted-foreground)",
            fontWeight: 600,
            "&:hover": { color: "var(--foreground)", backgroundColor: "transparent" },
          }}
        >
          Apps
        </Button>
      </Box>

      {isLoading && !data ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={40} width={192} />
          <Skeleton variant="rounded" height={64} />
          <Skeleton variant="rounded" height={256} />
        </Stack>
      ) : error && !data ? (
        <ErrorState description={error} onRetry={() => void load()} />
      ) : application ? (
        <>
          <Stack spacing={2}>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { sm: "flex-start" },
                justifyContent: { sm: "space-between" },
                gap: 2,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                  <Typography
                    variant="h4"
                    noWrap
                    sx={{ fontWeight: 600, letterSpacing: "-0.02em" }}
                  >
                    {application.name}
                  </Typography>
                  <StatusBadge status={application.status} sx={{ flexShrink: 0 }} />
                </Box>
                <Typography
                  variant="body2"
                  noWrap
                  sx={{ fontFamily: "var(--font-mono)", color: "var(--muted-foreground)" }}
                >
                  {application.slug}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", flexShrink: 0, flexWrap: "wrap", alignItems: "center", gap: 1 }}>
                <Button
                  type="button"
                  variant="outlined"
                  onClick={() => setRedeployOpen(true)}
                  startIcon={<RotateCw size={16} />}
                >
                  Redeploy
                </Button>
                <Button
                  component="a"
                  href={appUrl(application.slug)}
                  target="_blank"
                  rel="noreferrer"
                  variant="contained"
                  startIcon={<ExternalLink size={16} />}
                >
                  Open
                </Button>
                <IconButton
                  aria-label="More actions"
                  onClick={(event) => setMenuAnchor(event.currentTarget)}
                  sx={{
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    width: 36,
                    height: 36,
                  }}
                >
                  <MoreHorizontal size={16} />
                </IconButton>
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
                      setEditOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <Settings2 size={16} />
                    </ListItemIcon>
                    Edit
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuAnchor(null);
                      setRestartOpen(true);
                    }}
                  >
                    <ListItemIcon>
                      <RefreshCw size={16} />
                    </ListItemIcon>
                    Restart
                  </MenuItem>
                </Menu>
              </Box>
            </Box>

            <Card
              sx={{
                p: 2,
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                alignItems: { sm: "center" },
                gap: { xs: 1.5, sm: 2 },
              }}
            >
              <Box sx={{ display: "flex", minWidth: 0, flex: 1, alignItems: "center", gap: 1 }}>
                <Typography
                  variant="caption"
                  sx={{
                    flexShrink: 0,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted-foreground)",
                  }}
                >
                  URL
                </Typography>
                <CopyField value={appUrl(application.slug)} sx={{ flex: 1 }} />
              </Box>
              <Button
                component="a"
                href={appUrl(application.slug)}
                target="_blank"
                rel="noreferrer"
                variant="outlined"
                size="small"
                startIcon={<ExternalLink size={14} />}
              >
                Open
              </Button>
              {machines[0]?.sharedIpv4 && (
                <Box
                  sx={{
                    display: "flex",
                    minWidth: 0,
                    alignItems: "center",
                    gap: 1,
                    borderTop: { xs: "1px solid var(--border)", sm: "none" },
                    borderLeft: { xs: "none", sm: "1px solid var(--border)" },
                    pt: { xs: 1.5, sm: 0 },
                    pl: { xs: 0, sm: 2 },
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      flexShrink: 0,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "var(--muted-foreground)",
                    }}
                  >
                    IP
                  </Typography>
                  <CopyField value={machines[0].sharedIpv4} sx={{ flex: 1 }} />
                </Box>
              )}
            </Card>
          </Stack>

          <Box>
            <Tabs
              value={tab}
              onChange={(_, value) => selectTab(value as AppTab)}
              sx={{ borderBottom: "1px solid var(--border)", mb: 3 }}
            >
              {TABS.map((t) => (
                <Tab key={t.id} value={t.id} label={t.label} />
              ))}
            </Tabs>

            {tab === "overview" && (
              <OverviewTab
                application={application}
                machines={machines}
                onViewLogs={() => selectTab("logs")}
              />
            )}
            {tab === "logs" && (
              <MachineLogsViewer
                application={application}
                machines={machines}
              />
            )}
            {tab === "env" && (
              <EnvVarsTab
                application={application}
                onUpdated={(updated) =>
                  setData((current) =>
                    current ? { ...current, application: updated } : current
                  )
                }
              />
            )}
            {tab === "metrics" && <MetricsTab />}
            {tab === "settings" && (
              <SettingsTab
                application={application}
                onUpdated={(updated) =>
                  setData((current) =>
                    current ? { ...current, application: updated } : current
                  )
                }
                onDelete={() => {
                  router.push("/apps");
                  router.refresh();
                }}
              />
            )}
          </Box>

          <EditApplicationDialog
            application={application}
            open={editOpen}
            onOpenChange={setEditOpen}
            onUpdated={() => void load()}
          />
          <ComingSoonDialog
            open={redeployOpen}
            onOpenChange={setRedeployOpen}
            title="Redeploy"
            description="Redeploying is coming soon. You will be able to rebuild and redeploy this app from its image."
          />
          <ComingSoonDialog
            open={restartOpen}
            onOpenChange={setRestartOpen}
            title="Restart"
            description="Restarting is coming soon. You will be able to restart this app's machine from here."
          />
        </>
      ) : null}
    </Box>
  );
}

const queryClient = new QueryClient();

export function ApplicationDetailProvider({ id }: { id: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationDetail id={id} />
    </QueryClientProvider>
  );
}
