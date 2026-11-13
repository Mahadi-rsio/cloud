import { createStudioClient, type StudioConnection } from "@/lib/studio-db";
import type { Client, InValue } from "@libsql/client";
import { HttpError } from "@/lib/http";
import type {
  CreateColumnInput,
  CreateTableInput,
  StudioCellValue,
  StudioColumn,
  StudioFilterCondition,
  StudioForeignKey,
  StudioIndex,
  StudioQueryResult,
  StudioRowsResult,
  StudioSchema,
  StudioTableDetails,
  StudioTableInfo,
} from "@/lib/studio/types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const MAX_QUERY_ROWS = 1000;
const QUERY_TIMEOUT_MS = 12_000;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,63}$/;
const INTERNAL_TABLE_RE = /^(sqlite_|_litestream_|libsql_)/i;

const WRITE_RE =
  /(?:^|;)\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|ATTACH|DETACH|REINDEX|VACUUM|PRAGMA\s+[A-Za-z0-9_]+\s*=)/i;

const BLOCKED_SQL_RE = /\b(ATTACH\s+DATABASE|DETACH\s+DATABASE|load_extension)\b/i;

const ALLOWED_COLUMN_TYPES = new Set([
  "INTEGER",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "BOOLEAN",
  "DATETIME",
  "DATE",
  "JSON",
  "UUID",
  "BIGINT",
  "VARCHAR",
  "FLOAT",
  "ANY",
]);

const SAFE_DEFAULT_KEYWORDS = new Set([
  "CURRENT_TIMESTAMP",
  "CURRENT_DATE",
  "CURRENT_TIME",
  "NULL",
  "TRUE",
  "FALSE",
]);

export function quoteId(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function validateIdentifier(identifier: string, label = "Identifier"): string {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new HttpError("VALIDATION_ERROR", `${label} cannot be empty.`, 400);
  }
  if (!IDENTIFIER_RE.test(trimmed)) {
    throw new HttpError(
      "VALIDATION_ERROR",
      `${label} "${trimmed}" must start with a letter or underscore and contain only letters, numbers, underscores, hyphens, or $.`,
      400,
    );
  }
  if (INTERNAL_TABLE_RE.test(trimmed)) {
    throw new HttpError(
      "VALIDATION_ERROR",
      `${label} "${trimmed}" uses a reserved system prefix.`,
      400,
    );
  }
  return trimmed;
}

function assertNotSystemTable(table: string): string {
  const trimmed = table.trim();
  if (!trimmed) {
    throw new HttpError("VALIDATION_ERROR", "Table name cannot be empty.", 400);
  }
  if (INTERNAL_TABLE_RE.test(trimmed)) {
    throw new HttpError(
      "FORBIDDEN",
      `System table "${trimmed}" cannot be modified.`,
      403,
    );
  }
  return trimmed;
}

export function serializeCell(value: unknown): StudioCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof ArrayBuffer !== "undefined") {
    if (value instanceof ArrayBuffer) {
      return toHex(new Uint8Array(value));
    }
    if (ArrayBuffer.isView(value)) {
      return toHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
  }
  return String(value);
}

function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function toSqlArg(value: StudioCellValue | undefined): InValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new HttpError("PROVIDER_ERROR", `Query timed out after ${ms / 1000}s.`, 504));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim();
}

async function listTableColumns(client: Client, table: string): Promise<StudioColumn[]> {
  const result = await client.execute(`PRAGMA table_info(${quoteId(table)})`);
  return result.rows.map((row) => {
    const pkOrder = Number(row.pk ?? 0);
    return {
      cid: Number(row.cid ?? 0),
      name: String(row.name ?? ""),
      type: String(row.type ?? ""),
      notNull: Boolean(row.notnull),
      defaultValue: row.dflt_value !== null && row.dflt_value !== undefined ? String(row.dflt_value) : null,
      pk: pkOrder > 0,
      pkOrder,
    };
  });
}

async function getTableMetadata(
  client: Client,
  table: string,
): Promise<{ sql: string | null; withoutRowid: boolean }> {
  const res = await client.execute({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  if (res.rows.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }
  const sql = res.rows[0]?.sql ? String(res.rows[0].sql) : null;
  const withoutRowid = sql ? /\bWITHOUT\s+ROWID\b/i.test(sql) : false;
  return { sql, withoutRowid };
}

async function listTables(connection: StudioConnection): Promise<StudioTableInfo[]> {
  const client = await createStudioClient(connection);
  const result = await withTimeout(
    client.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' ORDER BY name",
    ),
    QUERY_TIMEOUT_MS,
  );

  const tables = result.rows.map((row) => ({
    name: String(row.name),
    sql: row.sql ? String(row.sql) : null,
  }));

  const infos: StudioTableInfo[] = await Promise.all(
    tables.map(async ({ name, sql }) => {
      const [columns, countRes] = await Promise.all([
        listTableColumns(client, name),
        client
          .execute(`SELECT COUNT(*) AS c FROM ${quoteId(name)}`)
          .catch(() => ({ rows: [{ c: 0 }] })),
      ]);
      const rowCount = Number(countRes.rows[0]?.c ?? 0);
      return {
        name,
        columnCount: columns.length,
        rowCount,
        sql,
      };
    }),
  );

  return infos;
}

async function getSchema(connection: StudioConnection): Promise<StudioSchema> {
  const client = await createStudioClient(connection);
  const result = await withTimeout(
    client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' ORDER BY name",
    ),
    QUERY_TIMEOUT_MS,
  );
  const names = result.rows.map((row) => String(row.name));
  const schema: StudioSchema = {};
  await Promise.all(
    names.map(async (name) => {
      schema[name] = await listTableColumns(client, name);
    }),
  );
  return schema;
}

async function getTableDetails(
  connection: StudioConnection,
  tableInput: string,
): Promise<StudioTableDetails> {
  const client = await createStudioClient(connection);
  const table = tableInput.trim();
  const { sql, withoutRowid } = await getTableMetadata(client, table);

  const [columns, fkRes, idxListRes] = await Promise.all([
    listTableColumns(client, table),
    client.execute(`PRAGMA foreign_key_list(${quoteId(table)})`),
    client.execute(`PRAGMA index_list(${quoteId(table)})`),
  ]);

  const foreignKeys: StudioForeignKey[] = fkRes.rows.map((row) => ({
    id: Number(row.id ?? 0),
    seq: Number(row.seq ?? 0),
    table: String(row.table ?? ""),
    from: String(row.from ?? ""),
    to: String(row.to ?? ""),
    onUpdate: String(row.on_update ?? "NO ACTION"),
    onDelete: String(row.on_delete ?? "NO ACTION"),
  }));

  const indexes: StudioIndex[] = await Promise.all(
    idxListRes.rows.map(async (idxRow) => {
      const idxName = String(idxRow.name ?? "");
      const infoRes = await client.execute(`PRAGMA index_info(${quoteId(idxName)})`);
      const idxCols = infoRes.rows
        .sort((a, b) => Number(a.seqno ?? 0) - Number(b.seqno ?? 0))
        .map((r) => String(r.name ?? ""))
        .filter(Boolean);
      return {
        name: idxName,
        unique: Boolean(idxRow.unique),
        origin: String(idxRow.origin ?? "c"),
        partial: Boolean(idxRow.partial),
        columns: idxCols,
      };
    }),
  );

  return {
    name: table,
    sql,
    withoutRowid,
    columns,
    foreignKeys,
    indexes,
  };
}

function buildWhereClause(
  columns: StudioColumn[],
  filters?: StudioFilterCondition[],
  search?: string,
): { whereSql: string; args: InValue[] } {
  const validCols = new Set(columns.map((c) => c.name));
  const clauses: string[] = [];
  const args: InValue[] = [];

  if (filters && filters.length > 0) {
    for (const f of filters) {
      if (!validCols.has(f.column)) continue;
      const colId = quoteId(f.column);
      const val = f.value ?? "";

      switch (f.operator) {
        case "is_null":
          clauses.push(`${colId} IS NULL`);
          break;
        case "is_not_null":
          clauses.push(`${colId} IS NOT NULL`);
          break;
        case "eq":
          clauses.push(`${colId} = ?`);
          args.push(val);
          break;
        case "neq":
          clauses.push(`${colId} != ?`);
          args.push(val);
          break;
        case "gt":
          clauses.push(`${colId} > ?`);
          args.push(val);
          break;
        case "gte":
          clauses.push(`${colId} >= ?`);
          args.push(val);
          break;
        case "lt":
          clauses.push(`${colId} < ?`);
          args.push(val);
          break;
        case "lte":
          clauses.push(`${colId} <= ?`);
          args.push(val);
          break;
        case "contains":
          clauses.push(`CAST(${colId} AS TEXT) LIKE ?`);
          args.push(`%${val}%`);
          break;
        case "starts_with":
          clauses.push(`CAST(${colId} AS TEXT) LIKE ?`);
          args.push(`${val}%`);
          break;
        case "ends_with":
          clauses.push(`CAST(${colId} AS TEXT) LIKE ?`);
          args.push(`%${val}`);
          break;
      }
    }
  }

  const trimmedSearch = search?.trim() ?? "";
  if (trimmedSearch && columns.length > 0) {
    const searchParts = columns.map((c) => `CAST(${quoteId(c.name)} AS TEXT) LIKE ?`);
    clauses.push(`(${searchParts.join(" OR ")})`);
    for (let i = 0; i < columns.length; i++) {
      args.push(`%${trimmedSearch}%`);
    }
  }

  if (clauses.length === 0) {
    return { whereSql: "", args: [] };
  }
  return {
    whereSql: ` WHERE ${clauses.join(" AND ")}`,
    args,
  };
}

interface GetRowsInput {
  table: string;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDir?: "asc" | "desc";
  filters?: StudioFilterCondition[];
  search?: string;
}

async function getRows(connection: StudioConnection, input: GetRowsInput): Promise<StudioRowsResult> {
  const client = await createStudioClient(connection);
  const table = input.table.trim();

  const { withoutRowid } = await getTableMetadata(client, table);
  const columns = await listTableColumns(client, table);
  if (columns.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }

  const pkColumns = columns
    .filter((c) => c.pk)
    .sort((a, b) => a.pkOrder - b.pkOrder);

  const hasPk = pkColumns.length > 0;
  const useHiddenRowid = !hasPk && !withoutRowid;
  const canMutateRows = hasPk || useHiddenRowid;

  const page = Math.max(0, Math.floor(input.page) || 0);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize) || DEFAULT_PAGE_SIZE));

  const validColumn = columns.some((c) => c.name === input.sortColumn);
  const orderBy =
    validColumn && input.sortColumn
      ? ` ORDER BY ${quoteId(input.sortColumn)} ${input.sortDir === "desc" ? "DESC" : "ASC"}`
      : "";

  const { whereSql, args: whereArgs } = buildWhereClause(columns, input.filters, input.search);

  const [totalResult, filteredResult] = await Promise.all([
    withTimeout(
      client.execute({ sql: `SELECT COUNT(*) AS c FROM ${quoteId(table)}`, args: [] }),
      QUERY_TIMEOUT_MS,
    ),
    whereSql
      ? withTimeout(
          client.execute({
            sql: `SELECT COUNT(*) AS c FROM ${quoteId(table)}${whereSql}`,
            args: whereArgs,
          }),
          QUERY_TIMEOUT_MS,
        )
      : Promise.resolve(null),
  ]);

  const total = Number(totalResult.rows[0]?.c ?? 0);
  const filteredTotal = filteredResult ? Number(filteredResult.rows[0]?.c ?? 0) : total;

  const selectCols = columns.map((c) => quoteId(c.name)).join(", ");
  const hiddenRowidAlias = "__studio_rowid__";
  const selectExpr = useHiddenRowid
    ? `rowid AS ${quoteId(hiddenRowidAlias)}, ${selectCols}`
    : selectCols;

  const rowsResult = await withTimeout(
    client.execute({
      sql: `SELECT ${selectExpr} FROM ${quoteId(table)}${whereSql}${orderBy} LIMIT ? OFFSET ?`,
      args: [...whereArgs, pageSize, page * pageSize],
    }),
    QUERY_TIMEOUT_MS,
  );

  const colNames = columns.map((c) => c.name);
  const rows: StudioCellValue[][] = [];
  const rowIdentities: Array<Record<string, StudioCellValue> | null> = [];

  for (const row of rowsResult.rows) {
    rows.push(colNames.map((name) => serializeCell(row[name])));
    if (hasPk) {
      const idObj: Record<string, StudioCellValue> = {};
      for (const pk of pkColumns) {
        idObj[pk.name] = serializeCell(row[pk.name]);
      }
      rowIdentities.push(idObj);
    } else if (useHiddenRowid) {
      rowIdentities.push({
        [hiddenRowidAlias]: serializeCell(row[hiddenRowidAlias]),
      });
    } else {
      rowIdentities.push(null);
    }
  }

  return {
    columns: colNames,
    columnTypes: columns,
    rows,
    rowIdentities,
    canMutateRows,
    withoutRowid,
    total,
    filteredTotal,
    page,
    pageSize,
  };
}

function buildRowIdentityWhere(
  columns: StudioColumn[],
  withoutRowid: boolean,
  identity: Record<string, StudioCellValue>,
): { whereSql: string; args: InValue[] } {
  const pkColumns = columns.filter((c) => c.pk).sort((a, b) => a.pkOrder - b.pkOrder);

  if (pkColumns.length > 0) {
    const parts: string[] = [];
    const args: InValue[] = [];
    for (const pk of pkColumns) {
      if (!(pk.name in identity)) {
        throw new HttpError(
          "VALIDATION_ERROR",
          `Missing primary key column "${pk.name}" in row identity.`,
          400,
        );
      }
      const val = identity[pk.name];
      if (val === null) {
        parts.push(`${quoteId(pk.name)} IS NULL`);
      } else {
        parts.push(`${quoteId(pk.name)} = ?`);
        args.push(toSqlArg(val));
      }
    }
    return { whereSql: parts.join(" AND "), args };
  }

  if (!withoutRowid && "__studio_rowid__" in identity && identity.__studio_rowid__ !== null) {
    return {
      whereSql: "rowid = ?",
      args: [toSqlArg(identity.__studio_rowid__)],
    };
  }

  throw new HttpError(
    "VALIDATION_ERROR",
    "This table does not have a primary key or rowid to uniquely identify rows.",
    400,
  );
}

interface InsertRowInput {
  table: string;
  row: Record<string, StudioCellValue>;
}

async function insertRow(
  connection: StudioConnection,
  input: InsertRowInput,
): Promise<{ rowsAffected: number; lastInsertRowid: string | null }> {
  const client = await createStudioClient(connection);
  const table = assertNotSystemTable(input.table);

  const columns = await listTableColumns(client, table);
  if (columns.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }
  const validColMap = new Map(columns.map((c) => [c.name, c]));

  const entries = Object.entries(input.row).filter(([key]) => validColMap.has(key));

  let sql: string;
  let args: InValue[] = [];

  if (entries.length === 0) {
    sql = `INSERT INTO ${quoteId(table)} DEFAULT VALUES`;
  } else {
    const colList = entries.map(([k]) => quoteId(k)).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    args = entries.map(([, v]) => toSqlArg(v));
    sql = `INSERT INTO ${quoteId(table)} (${colList}) VALUES (${placeholders})`;
  }

  const res = await withTimeout(client.execute({ sql, args }), QUERY_TIMEOUT_MS);
  return {
    rowsAffected: Number(res.rowsAffected ?? 1),
    lastInsertRowid:
      res.lastInsertRowid !== undefined && res.lastInsertRowid !== null
        ? String(res.lastInsertRowid)
        : null,
  };
}

interface UpdateRowInput {
  table: string;
  identity: Record<string, StudioCellValue>;
  changes: Record<string, StudioCellValue>;
}

async function updateRow(
  connection: StudioConnection,
  input: UpdateRowInput,
): Promise<{ rowsAffected: number }> {
  const client = await createStudioClient(connection);
  const table = assertNotSystemTable(input.table);

  const { withoutRowid } = await getTableMetadata(client, table);
  const columns = await listTableColumns(client, table);
  if (columns.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }

  const validCols = new Set(columns.map((c) => c.name));
  const changeEntries = Object.entries(input.changes).filter(([k]) => validCols.has(k));
  if (changeEntries.length === 0) {
    throw new HttpError("VALIDATION_ERROR", "No valid column changes provided.", 400);
  }

  const { whereSql, args: whereArgs } = buildRowIdentityWhere(columns, withoutRowid, input.identity);
  const setSql = changeEntries.map(([k]) => `${quoteId(k)} = ?`).join(", ");
  const setArgs = changeEntries.map(([, v]) => toSqlArg(v));

  const sql = `UPDATE ${quoteId(table)} SET ${setSql} WHERE ${whereSql}`;
  const res = await withTimeout(
    client.execute({ sql, args: [...setArgs, ...whereArgs] }),
    QUERY_TIMEOUT_MS,
  );

  return { rowsAffected: Number(res.rowsAffected ?? 0) };
}

interface DeleteRowsInput {
  table: string;
  identities: Array<Record<string, StudioCellValue>>;
}

async function deleteRows(
  connection: StudioConnection,
  input: DeleteRowsInput,
): Promise<{ rowsAffected: number }> {
  const client = await createStudioClient(connection);
  const table = assertNotSystemTable(input.table);

  if (input.identities.length === 0) {
    return { rowsAffected: 0 };
  }

  const { withoutRowid } = await getTableMetadata(client, table);
  const columns = await listTableColumns(client, table);
  if (columns.length === 0) {
    throw new HttpError("NOT_FOUND", `Table "${table}" does not exist.`, 404);
  }

  const statements = input.identities.map((identity) => {
    const { whereSql, args } = buildRowIdentityWhere(columns, withoutRowid, identity);
    return {
      sql: `DELETE FROM ${quoteId(table)} WHERE ${whereSql}`,
      args,
    };
  });

  const results = await withTimeout(client.batch(statements, "write"), QUERY_TIMEOUT_MS);
  const rowsAffected = results.reduce((sum, r) => sum + Number(r.rowsAffected ?? 0), 0);

  return { rowsAffected };
}

export function formatSafeDefaultValue(raw: string, colType: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const upper = trimmed.toUpperCase();
  if (SAFE_DEFAULT_KEYWORDS.has(upper)) {
    return upper;
  }

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  const upperType = colType.toUpperCase();
  if (upperType === "BOOLEAN" && (trimmed === "1" || trimmed === "0")) {
    return trimmed;
  }

  // Otherwise quote as SQL string literal
  const unquoted =
    trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2
      ? trimmed.slice(1, -1)
      : trimmed;
  return `'${unquoted.replace(/'/g, "''")}'`;
}

export function buildCreateTableSql(input: CreateTableInput): string {
  const tableName = validateIdentifier(input.name, "Table name");

  if (!input.columns || input.columns.length === 0) {
    throw new HttpError("VALIDATION_ERROR", "A table must have at least one column.", 400);
  }

  const seenNames = new Set<string>();
  const pkColumns = input.columns.filter((c) => c.primaryKey);
  const isCompositePk = pkColumns.length > 1;

  const colDefs: string[] = [];
  const fkDefs: string[] = [];

  for (const col of input.columns) {
    const colName = validateIdentifier(col.name, "Column name");
    const lower = colName.toLowerCase();
    if (seenNames.has(lower)) {
      throw new HttpError("VALIDATION_ERROR", `Duplicate column name "${colName}".`, 400);
    }
    seenNames.add(lower);

    const rawType = (col.type || "TEXT").trim().toUpperCase();
    const baseType = rawType.split(/\s*\(/)[0] ?? "TEXT";
    const safeType = ALLOWED_COLUMN_TYPES.has(baseType) ? baseType : "TEXT";

    const parts: string[] = [quoteId(colName)];

    if (col.primaryKey && !isCompositePk) {
      if (col.autoIncrement) {
        parts.push("INTEGER PRIMARY KEY AUTOINCREMENT");
      } else {
        parts.push(safeType, "PRIMARY KEY");
      }
    } else {
      parts.push(safeType);
    }

    if (col.notNull && !(col.primaryKey && !isCompositePk)) {
      parts.push("NOT NULL");
    }

    if (col.unique && !(col.primaryKey && !isCompositePk)) {
      parts.push("UNIQUE");
    }

    if (col.defaultValue !== undefined && col.defaultValue !== null && col.defaultValue.trim() !== "") {
      const formattedDefault = formatSafeDefaultValue(col.defaultValue, safeType);
      if (formattedDefault) {
        parts.push(`DEFAULT ${formattedDefault}`);
      }
    }

    if (col.references && col.references.table && col.references.column) {
      const refTable = validateIdentifier(col.references.table, "Referenced table");
      const refCol = validateIdentifier(col.references.column, "Referenced column");
      const onDelete = col.references.onDelete || "NO ACTION";
      const validActions = new Set(["NO ACTION", "RESTRICT", "SET NULL", "SET DEFAULT", "CASCADE"]);
      const safeAction = validActions.has(onDelete) ? onDelete : "NO ACTION";
      fkDefs.push(
        `FOREIGN KEY (${quoteId(colName)}) REFERENCES ${quoteId(refTable)}(${quoteId(refCol)}) ON DELETE ${safeAction}`,
      );
    }

    colDefs.push(parts.join(" "));
  }

  if (isCompositePk) {
    const pkColNames = pkColumns.map((c) => quoteId(validateIdentifier(c.name))).join(", ");
    colDefs.push(`PRIMARY KEY (${pkColNames})`);
  }

  const allDefs = [...colDefs, ...fkDefs];
  const ifNotExists = input.ifNotExists ? "IF NOT EXISTS " : "";
  const strictSuffix = input.strict ? " STRICT" : "";

  return `CREATE TABLE ${ifNotExists}${quoteId(tableName)} (\n  ${allDefs.join(",\n  ")}\n)${strictSuffix};`;
}

async function createTable(
  connection: StudioConnection,
  input: CreateTableInput,
): Promise<{ table: string; sql: string }> {
  const client = await createStudioClient(connection);
  const sql = buildCreateTableSql(input);
  await withTimeout(client.execute(sql), QUERY_TIMEOUT_MS);
  return { table: input.name.trim(), sql };
}

async function dropTable(
  connection: StudioConnection,
  tableInput: string,
): Promise<{ table: string }> {
  const client = await createStudioClient(connection);
  const table = validateIdentifier(assertNotSystemTable(tableInput), "Table name");
  await withTimeout(client.execute(`DROP TABLE ${quoteId(table)}`), QUERY_TIMEOUT_MS);
  return { table };
}

async function truncateTable(
  connection: StudioConnection,
  tableInput: string,
): Promise<{ table: string; rowsAffected: number }> {
  const client = await createStudioClient(connection);
  const table = validateIdentifier(assertNotSystemTable(tableInput), "Table name");
  const res = await withTimeout(client.execute(`DELETE FROM ${quoteId(table)}`), QUERY_TIMEOUT_MS);
  return { table, rowsAffected: Number(res.rowsAffected ?? 0) };
}

async function addColumn(
  connection: StudioConnection,
  tableInput: string,
  column: CreateColumnInput,
): Promise<{ table: string; column: string; sql: string }> {
  const client = await createStudioClient(connection);
  const table = validateIdentifier(assertNotSystemTable(tableInput), "Table name");
  const colName = validateIdentifier(column.name, "Column name");

  const rawType = (column.type || "TEXT").trim().toUpperCase();
  const baseType = rawType.split(/\s*\(/)[0] ?? "TEXT";
  const safeType = ALLOWED_COLUMN_TYPES.has(baseType) ? baseType : "TEXT";

  const parts: string[] = [quoteId(colName), safeType];

  if (column.notNull) {
    const defVal =
      column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue.trim() !== ""
        ? formatSafeDefaultValue(column.defaultValue, safeType)
        : safeType === "INTEGER" || safeType === "REAL" || safeType === "NUMERIC"
          ? "0"
          : "''";
    parts.push("NOT NULL", `DEFAULT ${defVal}`);
  } else if (column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue.trim() !== "") {
    const defVal = formatSafeDefaultValue(column.defaultValue, safeType);
    if (defVal) parts.push(`DEFAULT ${defVal}`);
  }

  if (column.references && column.references.table && column.references.column) {
    const refTable = validateIdentifier(column.references.table, "Referenced table");
    const refCol = validateIdentifier(column.references.column, "Referenced column");
    const onDelete = column.references.onDelete || "NO ACTION";
    const validActions = new Set(["NO ACTION", "RESTRICT", "SET NULL", "SET DEFAULT", "CASCADE"]);
    const safeAction = validActions.has(onDelete) ? onDelete : "NO ACTION";
    parts.push(`REFERENCES ${quoteId(refTable)}(${quoteId(refCol)}) ON DELETE ${safeAction}`);
  }

  const sql = `ALTER TABLE ${quoteId(table)} ADD COLUMN ${parts.join(" ")};`;
  await withTimeout(client.execute(sql), QUERY_TIMEOUT_MS);

  return { table, column: colName, sql };
}

async function dropColumn(
  connection: StudioConnection,
  tableInput: string,
  columnInput: string,
): Promise<{ table: string; column: string }> {
  const client = await createStudioClient(connection);
  const table = validateIdentifier(assertNotSystemTable(tableInput), "Table name");
  const colName = validateIdentifier(columnInput, "Column name");
  await withTimeout(
    client.execute(`ALTER TABLE ${quoteId(table)} DROP COLUMN ${quoteId(colName)}`),
    QUERY_TIMEOUT_MS,
  );
  return { table, column: colName };
}

async function renameTable(
  connection: StudioConnection,
  tableInput: string,
  newNameInput: string,
): Promise<{ oldName: string; newName: string }> {
  const client = await createStudioClient(connection);
  const oldName = validateIdentifier(assertNotSystemTable(tableInput), "Table name");
  const newName = validateIdentifier(assertNotSystemTable(newNameInput), "New table name");

  await withTimeout(
    client.execute(`ALTER TABLE ${quoteId(oldName)} RENAME TO ${quoteId(newName)}`),
    QUERY_TIMEOUT_MS,
  );
  return { oldName, newName };
}

interface RunQueryInput {
  sql: string;
  allowWrite: boolean;
}

async function runQuery(connection: StudioConnection, input: RunQueryInput): Promise<StudioQueryResult> {
  const client = await createStudioClient(connection);
  const sql = input.sql.trim();

  if (!sql) {
    throw new HttpError("VALIDATION_ERROR", "Query cannot be empty.", 400);
  }

  const stripped = stripSqlComments(sql);
  if (!stripped) {
    throw new HttpError("VALIDATION_ERROR", "Query contains only comments.", 400);
  }

  if (BLOCKED_SQL_RE.test(stripped)) {
    throw new HttpError(
      "FORBIDDEN",
      "ATTACH/DETACH DATABASE and extension loading are prohibited in the studio.",
      403,
    );
  }

  if (!input.allowWrite && WRITE_RE.test(stripped)) {
    throw new HttpError(
      "FORBIDDEN",
      "Write queries are disabled in Read-Only mode. Enable 'Write Mode' in the toolbar to run INSERT, UPDATE, DELETE, or DDL statements.",
      403,
    );
  }

  const started = performance.now();
  const result = await withTimeout(client.execute(sql), QUERY_TIMEOUT_MS);
  const durationMs = Math.max(0, Math.round(performance.now() - started));

  const names = result.columns ?? [];
  const allRows = (result.rows ?? []).map((row) =>
    names.map((name) => serializeCell(row[name])),
  );
  const truncated = allRows.length > MAX_QUERY_ROWS;
  const rows = allRows.slice(0, MAX_QUERY_ROWS);

  return {
    columns: names,
    rows,
    rowsAffected: typeof result.rowsAffected === "number" ? result.rowsAffected : null,
    lastInsertRowid:
      result.lastInsertRowid !== undefined && result.lastInsertRowid !== null
        ? String(result.lastInsertRowid)
        : null,
    durationMs,
    truncated,
    statementCount: 1,
  };
}

export const studioService = {
  listTables,
  getSchema,
  getTableDetails,
  getRows,
  insertRow,
  updateRow,
  deleteRows,
  createTable,
  dropTable,
  truncateTable,
  addColumn,
  dropColumn,
  renameTable,
  runQuery,
};
