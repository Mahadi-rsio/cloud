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
      a[b.name] = r[idx];
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

  constructor(url: string, authToken: string, namespace?: string) {
    super();
    // Normalize url for http/https client
    let httpUrl = url;
    if (httpUrl.startsWith("libsql://")) {
      httpUrl = httpUrl.replace("libsql://", "https://");
    }

    this.endpoint = httpUrl;
    this.authToken = authToken;

    this.client = createClient({
      url: this.endpoint,
      authToken: this.authToken,
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
