export type StudioCellValue = string | number | boolean | null;

export interface StudioColumn {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
}

export interface StudioTableInfo {
  name: string;
  columnCount: number;
}

export type StudioSchema = Record<string, StudioColumn[]>;

export interface StudioRowsResult {
  columns: string[];
  rows: StudioCellValue[][];
  total: number;
  page: number;
  pageSize: number;
}

export interface StudioQueryResult {
  columns: string[];
  rows: StudioCellValue[][];
  rowsAffected: number | null;
  durationMs: number;
  truncated: boolean;
}

export type StudioSortDir = "asc" | "desc";