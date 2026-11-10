"use client";

import * as React from "react";
import { Studio } from "@libsqlstudio/gui";
import "./libsql-studio-scoped.css";
import { LibsqlStudioDriver } from "./libsql-driver";
import type { DatabaseItem } from "@/lib/databases/client";

export interface DatabaseStudioViewProps {
  database: DatabaseItem;
  theme?: "dark" | "light";
  onClose?: () => void;
}

export function DatabaseStudioView({
  database,
  theme = "dark",
  onClose,
}: DatabaseStudioViewProps) {
  const driver = React.useMemo(() => {
    return new LibsqlStudioDriver(
      database.httpUrl,
      database.defaultToken,
      database.namespace,
    );
  }, [database.httpUrl, database.defaultToken, database.namespace]);

  React.useEffect(() => {
    return () => {
      try {
        driver.close();
      } catch {
        // Ignore close errors
      }
    };
  }, [driver]);

  // Keep Radix portals created by LibSQL Studio (such as table context menus and dropdowns)
  // styled by attaching the scoped class to any newly portalled node.
  React.useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (
              node.hasAttribute("data-radix-portal") ||
              node.hasAttribute("data-radix-popper-content-wrapper") ||
              node.classList.contains("radix-dropdown-menu-content")
            ) {
              if (!node.classList.contains("libsql-studio-root")) {
                node.classList.add("libsql-studio-root", theme);
              }
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true });

    return () => {
      observer.disconnect();
    };
  }, [theme]);

  return (
    <div
      className={`libsql-studio-root ${theme} relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground`}
    >
      <Studio
        driver={driver}
        name={database.name}
        theme={theme}
        color="blue"
        onBack={onClose}
      />
    </div>
  );
}

export default DatabaseStudioView;
