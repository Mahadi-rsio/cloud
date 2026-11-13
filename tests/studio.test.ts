import { describe, expect, it } from "vitest";
import {
  buildCreateTableSql,
  formatSafeDefaultValue,
  quoteId,
  serializeCell,
  validateIdentifier,
} from "../lib/studio-service";
import {
  formatCell,
  parseCellInput,
  toCsv,
  toJsonExport,
  toSqlInserts,
} from "../components/studio/format";

describe("SQLite Studio Service & Security Helpers", () => {
  it("quotes SQLite identifiers safely", () => {
    expect(quoteId("users")).toBe('"users"');
    expect(quoteId('weird"name')).toBe('"weird""name"');
  });

  it("validates table and column identifiers against injection or system prefixes", () => {
    expect(validateIdentifier("users_2026")).toBe("users_2026");
    expect(validateIdentifier("_custom_meta")).toBe("_custom_meta");

    expect(() => validateIdentifier("")).toThrow();
    expect(() => validateIdentifier("123_invalid")).toThrow();
    expect(() => validateIdentifier("users; DROP TABLE x")).toThrow();
    expect(() => validateIdentifier("sqlite_master")).toThrow();
    expect(() => validateIdentifier("_litestream_seq")).toThrow();
  });

  it("formats default values safely without SQL injection", () => {
    expect(formatSafeDefaultValue("CURRENT_TIMESTAMP", "DATETIME")).toBe("CURRENT_TIMESTAMP");
    expect(formatSafeDefaultValue("42", "INTEGER")).toBe("42");
    expect(formatSafeDefaultValue("3.14", "REAL")).toBe("3.14");
    expect(formatSafeDefaultValue("active", "TEXT")).toBe("'active'");
    expect(formatSafeDefaultValue("'already_quoted'", "TEXT")).toBe("'already_quoted'");
    expect(formatSafeDefaultValue("O'Reilly", "TEXT")).toBe("'O''Reilly'");
  });

  it("builds valid CREATE TABLE DDL with primary keys, defaults, and foreign keys", () => {
    const ddl = buildCreateTableSql({
      name: "orders",
      strict: true,
      columns: [
        {
          name: "id",
          type: "INTEGER",
          primaryKey: true,
          autoIncrement: true,
          notNull: true,
        },
        {
          name: "user_id",
          type: "INTEGER",
          notNull: true,
          references: {
            table: "users",
            column: "id",
            onDelete: "CASCADE",
          },
        },
        {
          name: "status",
          type: "TEXT",
          notNull: true,
          defaultValue: "pending",
        },
        {
          name: "code",
          type: "TEXT",
          unique: true,
        },
      ],
    });

    expect(ddl).toContain('CREATE TABLE "orders"');
    expect(ddl).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(ddl).toContain('"user_id" INTEGER NOT NULL');
    expect(ddl).toContain('"status" TEXT NOT NULL DEFAULT \'pending\'');
    expect(ddl).toContain('"code" TEXT UNIQUE');
    expect(ddl).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
    expect(ddl.endsWith(") STRICT;")).toBe(true);
  });

  it("builds composite primary keys when multiple PK columns are selected", () => {
    const ddl = buildCreateTableSql({
      name: "user_roles",
      columns: [
        { name: "user_id", type: "INTEGER", primaryKey: true, notNull: true },
        { name: "role_id", type: "INTEGER", primaryKey: true, notNull: true },
      ],
    });

    expect(ddl).toContain('PRIMARY KEY ("user_id", "role_id")');
  });

  it("serializes cell values including blobs and bigints", () => {
    expect(serializeCell(null)).toBeNull();
    expect(serializeCell(BigInt("9007199254740993"))).toBe("9007199254740993");
    expect(serializeCell(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("0xdeadbeef");
  });
});

describe("SQLite Studio Formatting & Export Utilities", () => {
  it("parses typed cell inputs accurately", () => {
    expect(parseCellInput("123", "INTEGER", false)).toBe(123);
    expect(parseCellInput("45.67", "REAL", false)).toBe(45.67);
    expect(parseCellInput("anything", "TEXT", true)).toBeNull();
    expect(parseCellInput("true", "BOOLEAN", false)).toBe(1);
    expect(parseCellInput("false", "BOOLEAN", false)).toBe(0);
    expect(parseCellInput("hello", "TEXT", false)).toBe("hello");
  });

  it("exports CSV, JSON, and SQL INSERT statements cleanly", () => {
    const cols = ["id", "name", "bio"];
    const rows = [
      [1, "Ada", null],
      [2, "Grace, Jr.", "Line 1\nLine 2"],
    ];

    expect(formatCell(null)).toBe("NULL");

    const csv = toCsv(cols, rows);
    expect(csv).toContain('1,Ada,');
    expect(csv).toContain('2,"Grace, Jr.","Line 1\nLine 2"');

    const json = JSON.parse(toJsonExport(cols, rows));
    expect(json).toHaveLength(2);
    expect(json[0]).toEqual({ id: 1, name: "Ada", bio: null });

    const sql = toSqlInserts("scientists", cols, rows);
    expect(sql).toContain('INSERT INTO "scientists" ("id", "name", "bio") VALUES (1, \'Ada\', NULL);');
  });
});
