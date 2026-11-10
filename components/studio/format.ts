import type { StudioCellValue } from "@/lib/studio/types";

export function formatCell(value: StudioCellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function isNullCell(value: StudioCellValue): boolean {
  return value === null;
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