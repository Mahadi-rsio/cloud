import Link from "next/link";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  AppWindow,
  Building2,
  Database,
  Globe,
  HardDrive,
  KeyRound,
  Terminal,
} from "lucide-react";

export const metadata = {
  title: "Documentation",
};

const PLATFORM_GUIDES = [
  {
    title: "Organizations & Teams",
    href: "/settings?tab=organization",
    badge: "Workspace",
    icon: Building2,
    summary:
      "Every new account starts with a Personal organization automatically. Use the organization selector in the sidebar to switch workspaces, create new organizations, invite teammates, or delete an organization.",
    bullets: [
      "Default Personal organization is provisioned automatically on signup with Owner permissions.",
      "Switch, create, invite members, or delete organizations directly from the sidebar selector.",
      "Manage member roles (Owner, Admin, Member) and pending invitations in Settings -> Organization.",
    ],
  },
  {
    title: "Apps & Deployments",
    href: "/apps",
    badge: "Compute",
    icon: AppWindow,
    summary:
      "Deploy and manage web services and background workers with real-time deployment logs, machine status, and environment configuration.",
    bullets: [
      "Create an application and track rollout history under Deployments.",
      "Inspect live machine state and streaming build/runtime logs.",
      "Bind custom domains or configure scaling per application.",
    ],
  },
  {
    title: "Databases & Studio",
    href: "/databases",
    badge: "SQLite",
    icon: Database,
    summary:
      "Provision managed SQLite databases and explore or edit your data directly in the built-in Studio.",
    bullets: [
      "Create tables visually with columns, types, primary keys, and defaults.",
      "Browse data with multi-condition filters, search, pagination, and inline cell editing.",
      "Run ad-hoc SQL queries in the Query Editor and export results as CSV, JSON, or SQL.",
    ],
  },
  {
    title: "Object Storage",
    href: "/storage",
    badge: "Storage",
    icon: HardDrive,
    summary:
      "Create isolated storage projects, generate scoped API keys, and monitor daily storage usage and audit events.",
    bullets: [
      "Organize buckets and objects per storage project.",
      "Issue and revoke project-level storage API keys.",
      "Track daily bandwidth and storage consumption metrics.",
    ],
  },
  {
    title: "Custom Domains",
    href: "/domains",
    badge: "Networking",
    icon: Globe,
    summary:
      "Attach custom domains to your deployed applications and verify DNS configuration.",
    bullets: [
      "Add apex or subdomain hostnames for any application.",
      "Check DNS propagation and TLS readiness.",
    ],
  },
  {
    title: "Authentication & API Keys",
    href: "/settings",
    badge: "Security",
    icon: KeyRound,
    summary:
      "Authenticate requests using session cookies or personal API keys via standard request headers.",
    bullets: [
      "Session-based auth powered by Better Auth with organization context.",
      "Send API keys using either the x-api-key header or Authorization: Bearer <key>.",
    ],
  },
] as const;

export default function DocsPage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.75 }}>
          Documentation
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
          Guides and reference notes for managing your Personal and team organizations,
          deploying apps, working with SQLite databases, and authenticating API requests.
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        {PLATFORM_GUIDES.map((guide) => {
          const Icon = guide.icon;
          return (
            <Grid key={guide.title} size={{ xs: 12, md: 6 }}>
              <Card
                sx={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--card)",
                }}
              >
                <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, flex: 1 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 1.5,
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                      <Box
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: "8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "var(--accent)",
                          color: "var(--primary)",
                        }}
                      >
                        <Icon size={18} />
                      </Box>
                      <Typography
                        component={Link}
                        href={guide.href}
                        variant="subtitle1"
                        sx={{
                          fontWeight: 600,
                          color: "var(--foreground)",
                          textDecoration: "none",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        {guide.title}
                      </Typography>
                    </Box>
                    <Chip
                      label={guide.badge}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: "0.7rem", height: 22 }}
                    />
                  </Box>

                  <Typography variant="body2" color="text.secondary">
                    {guide.summary}
                  </Typography>

                  <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.25, mt: "auto" }}>
                    {guide.bullets.map((bullet) => (
                      <Typography
                        key={bullet}
                        component="li"
                        variant="caption"
                        sx={{ color: "var(--muted-foreground)", lineHeight: 1.5 }}
                      >
                        {bullet}
                      </Typography>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Card
        sx={{
          border: "1px solid var(--border)",
          backgroundColor: "var(--card)",
        }}
      >
        <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Terminal size={18} style={{ color: "var(--primary)" }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Quick API Authentication Example
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Include your API key in either the <code>x-api-key</code> header or{" "}
            <code>Authorization: Bearer &lt;key&gt;</code> header when calling platform endpoints.
          </Typography>
          <Divider sx={{ borderColor: "var(--border)" }} />
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              borderRadius: "8px",
              backgroundColor: "var(--muted)",
              color: "var(--foreground)",
              fontSize: "0.8rem",
              fontFamily: "monospace",
              overflowX: "auto",
            }}
          >
            {`curl -s https://cloud.rsioex.workers.dev/api/apps \\
  -H "Authorization: Bearer YOUR_API_KEY"`}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
