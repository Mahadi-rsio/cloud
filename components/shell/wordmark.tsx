import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

/** Cloudisy wordmark. `collapsed` renders the mark only (collapsed rail). */
export function Wordmark({
  collapsed = false,
  sx,
}: {
  collapsed?: boolean;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="span"
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          gap: 1.25,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          width: 28,
          height: 28,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "8px",
          backgroundColor: "var(--primary)",
          color: "var(--primary-foreground)",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          width={16}
          height={16}
        >
          <path
            d="M7.2 17.5a4.3 4.3 0 1 1 .6-8.56 5.4 5.4 0 0 1 10.3 1.94A3.7 3.7 0 0 1 15.6 17.5H7.2Z"
            fill="currentColor"
          />
        </svg>
      </Box>
      {!collapsed && (
        <Typography
          component="span"
          sx={{
            fontSize: "1rem",
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--foreground)",
          }}
        >
          Cloudisy
        </Typography>
      )}
    </Box>
  );
}
