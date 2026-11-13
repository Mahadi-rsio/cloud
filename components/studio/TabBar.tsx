"use client";

import { Plus, Table2, Terminal, X } from "lucide-react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import { useStudioStore } from "@/stores/studio-store";

export function TabBar() {
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const closeTab = useStudioStore((s) => s.closeTab);
  const newQuery = useStudioStore((s) => s.newQuery);

  return (
    <Box
      sx={{
        display: "flex",
        height: 36,
        flexShrink: 0,
        alignItems: "center",
        overflowX: "auto",
        borderBottom: "1px solid var(--border)",
        bgcolor: "rgba(255,255,255,0.02)",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <Box
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.title}
            sx={{
              display: "flex",
              height: "100%",
              maxWidth: 180,
              flexShrink: 0,
              cursor: "pointer",
              userSelect: "none",
              alignItems: "center",
              gap: 0.75,
              borderRight: "1px solid var(--border)",
              px: 1.5,
              fontSize: 12,
              fontWeight: 500,
              bgcolor: active ? "var(--background)" : "transparent",
              color: active ? "var(--foreground)" : "var(--muted-foreground)",
              "&:hover": {
                bgcolor: active ? "var(--background)" : "rgba(255,255,255,0.04)",
              },
              "&:hover .tab-close-btn": {
                opacity: 1,
              },
            }}
          >
            {tab.kind === "table" ? (
              <Table2 style={{ width: 14, height: 14, flexShrink: 0, color: "var(--primary)" }} />
            ) : (
              <Terminal style={{ width: 14, height: 14, flexShrink: 0, color: "var(--muted-foreground)" }} />
            )}
            <Box
              component="span"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tab.title}
            </Box>
            <IconButton
              className="tab-close-btn"
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
              sx={{
                p: 0.25,
                opacity: active ? 1 : 0,
                transition: "opacity 150ms",
                color: "inherit",
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </IconButton>
          </Box>
        );
      })}
      <IconButton
        size="small"
        onClick={newQuery}
        title="New query"
        sx={{
          flexShrink: 0,
          px: 1.5,
          borderRadius: 0,
          color: "var(--muted-foreground)",
          "&:hover": { color: "var(--foreground)" },
        }}
      >
        <Plus style={{ width: 14, height: 14 }} />
      </IconButton>
    </Box>
  );
}
