"use client";

import { Layers, Plus, Table2, Terminal, X } from "lucide-react";
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
        minHeight: 42,
        height: 42,
        flexShrink: 0,
        alignItems: "stretch",
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
        borderBottom: "1px solid var(--border)",
        bgcolor: "var(--card)",
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
              position: "relative",
              display: "flex",
              minHeight: 40,
              height: "100%",
              maxWidth: { xs: 170, sm: 210 },
              flexShrink: 0,
              cursor: "pointer",
              userSelect: "none",
              alignItems: "center",
              gap: 0.75,
              borderRight: "1px solid var(--border)",
              borderTop: active ? "2px solid var(--primary)" : "2px solid transparent",
              pl: 1.5,
              pr: 0.75,
              fontSize: 12.5,
              fontWeight: active ? 600 : 500,
              bgcolor: active ? "var(--background)" : "transparent",
              color: active ? "var(--foreground)" : "var(--muted-foreground)",
              transition: "background-color 0.1s",
              "&:hover": {
                bgcolor: active ? "var(--background)" : "var(--accent)",
              },
              "&:hover .tab-close-btn": {
                opacity: 1,
              },
            }}
          >
            {tab.kind === "table" ? (
              <Table2 style={{ width: 14, height: 14, flexShrink: 0, color: "var(--primary)" }} />
            ) : tab.kind === "schema" ? (
              <Layers style={{ width: 14, height: 14, flexShrink: 0, color: "var(--success)" }} />
            ) : (
              <Terminal style={{ width: 14, height: 14, flexShrink: 0, color: "var(--muted-foreground)" }} />
            )}
            <Box
              component="span"
              sx={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: tab.kind === "table" ? "var(--font-mono)" : "inherit",
              }}
            >
              {tab.title}
            </Box>
            <IconButton
              className="tab-close-btn"
              size="small"
              aria-label={`Close ${tab.title} tab`}
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
              sx={{
                width: 24,
                height: 24,
                minWidth: 24,
                minHeight: 24,
                p: 0,
                borderRadius: "6px",
                opacity: { xs: 0.85, md: active ? 1 : 0 },
                transition: "opacity 150ms, background-color 150ms",
                color: "inherit",
                "&:hover": { bgcolor: "var(--accent)" },
              }}
            >
              <X size={13} />
            </IconButton>
          </Box>
        );
      })}
      <IconButton
        size="small"
        onClick={newQuery}
        aria-label="New SQL query tab"
        title="New SQL query tab"
        sx={{
          flexShrink: 0,
          minWidth: 44,
          width: 44,
          height: "100%",
          minHeight: 40,
          borderRadius: 0,
          borderRight: "1px solid var(--border)",
          color: "var(--muted-foreground)",
          "&:hover": { color: "var(--foreground)", bgcolor: "var(--accent)" },
        }}
      >
        <Plus size={16} />
      </IconButton>
    </Box>
  );
}
