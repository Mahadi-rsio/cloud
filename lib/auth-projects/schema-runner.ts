import SCHEMA_SQL from "@/auth/schema/better-auth-sqlite.sql?raw";
import { createTenantClient } from "@/lib/databases/tenant-client";

export async function applyAuthSchema(
  namespace: string,
  authToken: string,
): Promise<void> {
  const client = await createTenantClient(namespace, authToken);
  try {
    const statements = SCHEMA_SQL.split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.execute(statement);
    }
  } finally {
    client.close();
  }
}
