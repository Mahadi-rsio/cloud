import type { NextRequest } from "next/server";
import { z } from "zod";
import { LibsqlError } from "@libsql/client";
import { errorResponse, jsonError, jsonOk, readJson } from "@/lib/http";
import { studioService } from "@/lib/studio-service";
import { requireStudioAdmin } from "@/lib/studio-auth";
import { databaseService } from "@/lib/databases/service";

const ConnectionSchema = z.object({
  connection: z.object({
    databaseId: z.string().uuid(),
  }),
});

const TablesSchema = z.object({ action: z.literal("tables") }).merge(ConnectionSchema);

const SchemaSchema = z.object({ action: z.literal("schema") }).merge(ConnectionSchema);

const RowsSchema = z
  .object({
    action: z.literal("rows"),
    table: z.string().trim().min(1).max(128),
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(500).default(50),
    sortColumn: z.string().max(128).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .merge(ConnectionSchema);

const QuerySchema = z
  .object({
    action: z.literal("query"),
    sql: z.string().min(1).max(10_000),
    allowWrite: z.boolean().default(false),
  })
  .merge(ConnectionSchema);

const RequestSchema = z.discriminatedUnion("action", [
  TablesSchema,
  SchemaSchema,
  RowsSchema,
  QuerySchema,
]);

export async function POST(request: NextRequest) {
  try {
    const user = await requireStudioAdmin();
    const input = RequestSchema.parse(await readJson(request));

    // Resolve the selected database (must belong to the current user) and
    // connect through the data-plane with its namespace + token.
    const database = await databaseService.get(input.connection.databaseId, user.id);
    const connection = {
      namespace: database.namespace,
      token: database.defaultToken,
    };

    switch (input.action) {
      case "tables":
        return jsonOk(await studioService.listTables(connection));
      case "schema":
        return jsonOk(await studioService.getSchema(connection));
      case "rows":
        return jsonOk(
          await studioService.getRows(connection, {
            table: input.table,
            page: input.page,
            pageSize: input.pageSize,
            sortColumn: input.sortColumn,
            sortDir: input.sortDir,
          }),
        );
      case "query":
        return jsonOk(
          await studioService.runQuery(connection, {
            sql: input.sql,
            allowWrite: input.allowWrite,
          }),
        );
    }
  } catch (error) {
    if (error instanceof LibsqlError) {
      return jsonError("PROVIDER_ERROR", error.message, 502);
    }
    return errorResponse(error);
  }
}