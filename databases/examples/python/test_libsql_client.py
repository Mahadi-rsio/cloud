import os
import sys
import time
import libsql_client

url = os.environ.get("DB_URL", "http://test_user.localhost:8080")
auth_token = os.environ.get("DB_TOKEN")

if not auth_token:
    print("Error: DB_TOKEN environment variable is required", file=sys.stderr)
    sys.exit(1)

print(f"[Python libsql-client] Connecting to {url}...")

client = libsql_client.create_client_sync(url=url, auth_token=auth_token)

def main():
    # 1. Create table
    client.execute("""
        CREATE TABLE IF NOT EXISTS py_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sku TEXT NOT NULL UNIQUE,
            quantity INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
    """)

    unique_sku = f"SKU-{int(time.time())}"
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # 2. Insert record with positional params
    print(f"[Python libsql-client] Inserting item with SKU {unique_sku}...")
    client.execute(
        "INSERT INTO py_items (title, sku, quantity, created_at) VALUES (?, ?, ?, ?);",
        ["High-Performance SSD", unique_sku, 25, now_iso]
    )

    # 3. Query record
    print(f"[Python libsql-client] Querying item with SKU {unique_sku}...")
    res = client.execute("SELECT id, title, sku, quantity, created_at FROM py_items WHERE sku = ?;", [unique_sku])
    
    if len(res.rows) == 0:
        raise ValueError("Item was not found after insert")
    
    row = res.rows[0]
    row_dict = dict(zip(res.columns, row))
    print("[Python libsql-client] Retrieved:", row_dict)
    
    # 4. Update record
    client.execute("UPDATE py_items SET quantity = quantity + ? WHERE sku = ?;", [10, unique_sku])
    res_updated = client.execute("SELECT quantity FROM py_items WHERE sku = ?;", [unique_sku])
    new_qty = res_updated.rows[0][0]
    print(f"[Python libsql-client] Updated quantity to: {new_qty}")

    client.close()
    print("✅ [Python libsql-client] Test passed successfully!")

if __name__ == "__main__":
    main()
