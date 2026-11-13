"use client";

import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { Check, Copy } from "lucide-react";

/** Monospace, truncated value with a copy button. Used for machine strings
 * (URLs, IPs, IDs, image names). */
export function CopyField({
  value,
  sx,
  display,
  label,
}: {
  value: string;
  display?: string;
  sx?: SxProps<Theme>;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box
      component="span"
      sx={[
        {
          display: "inline-flex",
          minWidth: 0,
          alignItems: "center",
          gap: 0.75,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <Typography
        component="span"
        title={value}
        noWrap
        sx={{
          minWidth: 0,
          flex: 1,
          fontFamily: "var(--font-mono)",
          fontSize: "0.875rem",
          color: "var(--foreground)",
        }}
      >
        {display ?? value}
      </Typography>
      <Tooltip title={copied ? "Copied" : "Copy"} arrow>
        <IconButton
          type="button"
          size="small"
          aria-label={label ?? `Copy ${value}`}
          onClick={() => void copy()}
          sx={{
            width: 24,
            height: 24,
            flexShrink: 0,
            color: copied ? "var(--success)" : "var(--muted-foreground)",
            "&:hover": {
              color: copied ? "var(--success)" : "var(--foreground)",
            },
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}
