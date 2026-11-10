import {
  createClient,
  type Client,
  type InStatement,
  type ResultSet,
} from "@libsql/client/web";
import {
  SqliteLikeBaseDriver,
  type DatabaseHeader,
  type DatabaseResultSet,
  type DatabaseRow,
  convertSqliteType,
} from "@libsqlstudio/gui/driver";

export const DEFAULT_LIBSQL_DATA_URL =
  process.env.NEXT_PUBLIC_LIBSQL_DATA_URL ||
  "https://libsql-database-service.fly.dev";

function resolveHttpUrl(url?: string): string {
  if (!url) return DEFAULT_LIBSQL_DATA_URL;

  let httpUrl = url.trim();
  if (httpUrl.startsWith("libsql://")) {
    httpUrl = httpUrl.replace("libsql://", "https://");
  }

  // If the host is unresolvable cloudisy.top, route directly to the libSQL cluster data plane
  if (httpUrl.includes("cloudisy.top")) {
    return DEFAULT_LIBSQL_DATA_URL;
  }

  return httpUrl;
}

function transformRawResult(raw: ResultSet): DatabaseResultSet {
  const headerSet = new Set<string>();

  const headers: DatabaseHeader[] = raw.columns.map((colName, colIdx) => {
    const colType = raw.columnTypes[colIdx];
    let renameColName = colName;

    for (let i = 0; i < 20; i++) {
      if (!headerSet.has(renameColName)) break;
      renameColName = `__${colName}_${i}`;
    }

    headerSet.add(renameColName);

    return {
      name: renameColName,
      displayName: colName,
      originalType: colType,
      type: convertSqliteType(colType),
    };
  });

  const rows = raw.rows.map((r) =>
    headers.reduce((a, b, idx) => {
      const rowAny = r as any;
      const val =
        rowAny[idx] !== undefined ? rowAny[idx] : rowAny[b.displayName];
      a[b.name] = val;
      return a;
    }, {} as DatabaseRow),
  );

  return {
    rows,
    rowsAffected: raw.rowsAffected,
    headers,
    lastInsertRowid:
      raw.lastInsertRowid === undefined
        ? undefined
        : Number(raw.lastInsertRowid),
  };
}

export class LibsqlStudioDriver extends SqliteLikeBaseDriver {
  protected client: Client;
  protected endpoint: string;
  protected authToken: string;
  protected namespace?: string;

  constructor(url: string, authToken: string, namespace?: string) {
    super();

    this.endpoint = resolveHttpUrl(url);
    this.authToken = authToken;
    this.namespace = namespace;

    const ns = this.namespace;
    const token = this.authToken;

    this.client = createClient({
      url: this.endpoint,
      authToken: this.authToken,
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        let headers: Headers;
        if (typeof Request !== "undefined" && input instanceof Request) {
          headers = new Headers(input.headers);
        } else {
          headers = new Headers(init?.headers);
        }

        if (ns) {
          headers.set("x-namespace", ns);
        }
        if (token) {
          headers.set("Authorization", `Bearer ${token}`);
        }

        return fetch(input, { ...init, headers });
      },
    });
  }

  supportBigInt(): boolean {
    return false;
  }

  async query(stmt: InStatement): Promise<DatabaseResultSet> {
    const r = await this.client.execute(stmt);
    return transformRawResult(r);
  }

  async transaction(stmts: InStatement[]): Promise<DatabaseResultSet[]> {
    const results = await this.client.batch(stmts, "write");
    return results.map(transformRawResult);
  }

  override close(): void {
    this.client.close();
  }
}
