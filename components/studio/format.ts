import type { StudioCellValue } from "@/lib/studio/types";

export function formatCell(value: StudioCellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function isNullCell(value: StudioCellValue): boolean {
  return value === null;
}

export function parseCellInput(raw: string, columnType: string, isNull: boolean): StudioCellValue {
  if (isNull) return null;
  const upperType = (columnType || "TEXT").toUpperCase();

  if (upperType.includes("BOOL")) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "1") return 1;
    if (trimmed === "false" || trimmed === "0") return 0;
  }

  if (
    upperType.includes("INT") ||
    upperType.includes("REAL") ||
    upperType.includes("FLOA") ||
    upperType.includes("DOUB") ||
    upperType.includes("NUMERIC") ||
    upperType.includes("DECIMAL")
  ) {
    const trimmed = raw.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed))) {
      return Number(trimmed);
    }
  }

  return raw;
}

export function toCsv(columns: string[], rows: StudioCellValue[][]): string {
  const escape = (value: string) => {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const lines = [columns.map(escape).join(",")];
  for (const row of rows) {
    lines.push(
      row
        .map((cell) => escape(cell === null ? "" : String(cell)))
        .join(","),
    );
  }
  return lines.join("\n");
}

export function toJsonExport(columns: string[], rows: StudioCellValue[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, StudioCellValue> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

export function toSqlInserts(
  table: string,
  columns: string[],
  rows: StudioCellValue[][],
): string {
  if (rows.length === 0 || columns.length === 0) return "-- No rows to export";
  const quoteId = (id: string) => `"${id.replace(/"/g, '""')}"`;
  const formatVal = (val: StudioCellValue) => {
    if (val === null) return "NULL";
    if (typeof val === "number") return String(val);
    if (typeof val === "boolean") return val ? "1" : "0";
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const colList = columns.map(quoteId).join(", ");
  return rows
    .map((row) => {
      const vals = row.map(formatVal).join(", ");
      return `INSERT INTO ${quoteId(table)} (${colList}) VALUES (${vals});`;
    })
    .join("\n");
}
