"use client";

import * as React from "react";
import { Studio } from "@libsqlstudio/gui";
import "@libsqlstudio/gui/css";
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-background text-foreground">
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
