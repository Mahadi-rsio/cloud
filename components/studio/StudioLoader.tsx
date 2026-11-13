"use client";

import dynamic from "next/dynamic";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";

const Studio = dynamic(() => import("@/components/studio/Studio").then((m) => m.Studio), {
  ssr: false,
  loading: () => (
    <Box
      sx={{
        display: "flex",
        height: "100dvh",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "var(--background)",
      }}
    >
      <CircularProgress size={24} sx={{ color: "var(--muted-foreground)" }} />
    </Box>
  ),
});

export function StudioLoader() {
  return <Studio />;
}
