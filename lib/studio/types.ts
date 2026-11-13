export type StudioCellValue = string | number | boolean | null;

export interface StudioColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  pk: boolean;
  pkOrder: number;
}

export interface StudioForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  onUpdate: string;
  onDelete: string;
}

export interface StudioIndex {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
}

export interface StudioTableDetails {
  name: string;
  sql: string | null;
  withoutRowid: boolean;
  columns: StudioColumn[];
  foreignKeys: StudioForeignKey[];
  indexes: StudioIndex[];
}

export interface StudioTableInfo {
  name: string;
  columnCount: number;
  rowCount: number;
  sql: string | null;
}

export type StudioSchema = Record<string, StudioColumn[]>;

export type StudioFilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null";

export interface StudioFilterCondition {
  id?: string;
  column: string;
  operator: StudioFilterOperator;
  value?: string;
}

export interface StudioRowsResult {
  columns: string[];
  columnTypes: StudioColumn[];
  rows: StudioCellValue[][];
  rowIdentities: Array<Record<string, StudioCellValue> | null>;
  canMutateRows: boolean;
  withoutRowid: boolean;
  total: number;
  filteredTotal: number;
  page: number;
  pageSize: number;
}

export interface StudioQueryResult {
  columns: string[];
  rows: StudioCellValue[][];
  rowsAffected: number | null;
  lastInsertRowid: string | null;
  durationMs: number;
  truncated: boolean;
  statementCount: number;
}

export type StudioSortDir = "asc" | "desc";

export interface CreateColumnInput {
  name: string;
  type: string;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  notNull?: boolean;
  unique?: boolean;
  defaultValue?: string | null;
  references?: {
    table: string;
    column: string;
    onDelete?: "NO ACTION" | "RESTRICT" | "SET NULL" | "SET DEFAULT" | "CASCADE";
  } | null;
}

export interface CreateTableInput {
  name: string;
  columns: CreateColumnInput[];
  ifNotExists?: boolean;
  strict?: boolean;
}
