import type { NextRequest } from "next/server";
import { z } from "zod";
import { LibsqlError } from "@libsql/client";
import { errorResponse, jsonError, jsonOk, readJson } from "@/lib/http";
import { studioService } from "@/lib/studio-service";
import { requireStudioAdmin } from "@/lib/studio-auth";
import { databaseService } from "@/lib/databases/service";
import { assertRateLimit } from "@/lib/rate-limit";

const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const ConnectionSchema = z.object({
  connection: z.object({
    databaseId: z.string().uuid(),
  }),
});

const FilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
]);

const FilterConditionSchema = z.object({
  id: z.string().optional(),
  column: z.string().min(1).max(128),
  operator: FilterOperatorSchema,
  value: z.string().max(1000).optional(),
});

const ColumnDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.string().trim().min(1).max(32),
  primaryKey: z.boolean().optional(),
  autoIncrement: z.boolean().optional(),
  notNull: z.boolean().optional(),
  unique: z.boolean().optional(),
  defaultValue: z.string().max(256).nullable().optional(),
  references: z
    .object({
      table: z.string().trim().min(1).max(64),
      column: z.string().trim().min(1).max(64),
      onDelete: z
        .enum(["NO ACTION", "RESTRICT", "SET NULL", "SET DEFAULT", "CASCADE"])
        .optional(),
    })
    .nullable()
    .optional(),
});

const TablesSchema = z.object({ action: z.literal("tables") }).merge(ConnectionSchema);

const SchemaSchema = z.object({ action: z.literal("schema") }).merge(ConnectionSchema);

const TableDetailsSchema = z
  .object({
    action: z.literal("table_details"),
    table: z.string().trim().min(1).max(128),
  })
  .merge(ConnectionSchema);

const RowsSchema = z
  .object({
    action: z.literal("rows"),
    table: z.string().trim().min(1).max(128),
    page: z.number().int().min(0).default(0),
    pageSize: z.number().int().min(1).max(500).default(50),
    sortColumn: z.string().max(128).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    filters: z.array(FilterConditionSchema).max(20).optional(),
    search: z.string().max(256).optional(),
  })
  .merge(ConnectionSchema);

const InsertRowSchema = z
  .object({
    action: z.literal("insert_row"),
    table: z.string().trim().min(1).max(128),
    row: z.record(z.string(), CellValueSchema),
  })
  .merge(ConnectionSchema);

const UpdateRowSchema = z
  .object({
    action: z.literal("update_row"),
    table: z.string().trim().min(1).max(128),
    identity: z.record(z.string(), CellValueSchema),
    changes: z.record(z.string(), CellValueSchema),
  })
  .merge(ConnectionSchema);

const DeleteRowsSchema = z
  .object({
    action: z.literal("delete_rows"),
    table: z.string().trim().min(1).max(128),
    identities: z.array(z.record(z.string(), CellValueSchema)).min(1).max(200),
  })
  .merge(ConnectionSchema);

const CreateTableSchema = z
  .object({
    action: z.literal("create_table"),
    name: z.string().trim().min(1).max(64),
    columns: z.array(ColumnDefinitionSchema).min(1).max(64),
    ifNotExists: z.boolean().optional(),
    strict: z.boolean().optional(),
  })
  .merge(ConnectionSchema);

const DropTableSchema = z
  .object({
    action: z.literal("drop_table"),
    table: z.string().trim().min(1).max(64),
  })
  .merge(ConnectionSchema);

const TruncateTableSchema = z
  .object({
    action: z.literal("truncate_table"),
    table: z.string().trim().min(1).max(64),
  })
  .merge(ConnectionSchema);

const AddColumnSchema = z
  .object({
    action: z.literal("add_column"),
    table: z.string().trim().min(1).max(64),
    column: ColumnDefinitionSchema,
  })
  .merge(ConnectionSchema);

const DropColumnSchema = z
  .object({
    action: z.literal("drop_column"),
    table: z.string().trim().min(1).max(64),
    column: z.string().trim().min(1).max(64),
  })
  .merge(ConnectionSchema);

const RenameTableSchema = z
  .object({
    action: z.literal("rename_table"),
    table: z.string().trim().min(1).max(64),
    newName: z.string().trim().min(1).max(64),
  })
  .merge(ConnectionSchema);

const QuerySchema = z
  .object({
    action: z.literal("query"),
    sql: z.string().min(1).max(20_000),
    allowWrite: z.boolean().default(false),
  })
  .merge(ConnectionSchema);

const RequestSchema = z.discriminatedUnion("action", [
  TablesSchema,
  SchemaSchema,
  TableDetailsSchema,
  RowsSchema,
  InsertRowSchema,
  UpdateRowSchema,
  DeleteRowsSchema,
  CreateTableSchema,
  DropTableSchema,
  TruncateTableSchema,
  AddColumnSchema,
  DropColumnSchema,
  RenameTableSchema,
  QuerySchema,
]);

export async function POST(request: NextRequest) {
  try {
    const user = await requireStudioAdmin();

    // Enforce studio API rate limit per user
    try {
      await assertRateLimit(`studio:${user.id}`, { limit: 180, windowSeconds: 60 });
    } catch (err) {
      // Allow graceful fallback if Redis is unavailable in local dev, but block if rate limited
      if (err && typeof err === "object" && "code" in err && err.code === "RATE_LIMITED") {
        throw err;
      }
    }

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
      case "table_details":
        return jsonOk(await studioService.getTableDetails(connection, input.table));
      case "rows":
        return jsonOk(
          await studioService.getRows(connection, {
            table: input.table,
            page: input.page,
            pageSize: input.pageSize,
            sortColumn: input.sortColumn,
            sortDir: input.sortDir,
            filters: input.filters,
            search: input.search,
          }),
        );
      case "insert_row":
        return jsonOk(
          await studioService.insertRow(connection, {
            table: input.table,
            row: input.row,
          }),
        );
      case "update_row":
        return jsonOk(
          await studioService.updateRow(connection, {
            table: input.table,
            identity: input.identity,
            changes: input.changes,
          }),
        );
      case "delete_rows":
        return jsonOk(
          await studioService.deleteRows(connection, {
            table: input.table,
            identities: input.identities,
          }),
        );
      case "create_table":
        return jsonOk(
          await studioService.createTable(connection, {
            name: input.name,
            columns: input.columns,
            ifNotExists: input.ifNotExists,
            strict: input.strict,
          }),
        );
      case "drop_table":
        return jsonOk(await studioService.dropTable(connection, input.table));
      case "truncate_table":
        return jsonOk(await studioService.truncateTable(connection, input.table));
      case "add_column":
        return jsonOk(await studioService.addColumn(connection, input.table, input.column));
      case "drop_column":
        return jsonOk(await studioService.dropColumn(connection, input.table, input.column));
      case "rename_table":
        return jsonOk(
          await studioService.renameTable(connection, input.table, input.newName),
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
