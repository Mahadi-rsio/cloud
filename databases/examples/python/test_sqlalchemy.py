import os
import sys
import time
import libsql_client
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, select, insert, update
from sqlalchemy.dialects import sqlite

url = os.environ.get("DB_URL", "http://test_user.localhost:8080")
auth_token = os.environ.get("DB_TOKEN")

if not auth_token:
    print("Error: DB_TOKEN environment variable is required", file=sys.stderr)
    sys.exit(1)

print(f"[SQLAlchemy] Connecting via libsql-client to {url}...")

# LibSQL client instance
client = libsql_client.create_client_sync(url=url, auth_token=auth_token)

# SQLAlchemy Schema Definition
metadata = MetaData()
products = Table(
    "sqlalchemy_products",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String, nullable=False),
    Column("category", String, nullable=False),
    Column("price", Integer, nullable=False),
)

def main():
    # 1. Create table
    client.execute("""
        CREATE TABLE IF NOT EXISTS sqlalchemy_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price INTEGER NOT NULL
        );
    """)

    # 2. Build insert query using SQLAlchemy Core
    product_name = f"Mechanical Keyboard {int(time.time())}"
    ins_stmt = insert(products).values(
        name=product_name,
        category="Electronics",
        price=120
    )
    compiled_ins = ins_stmt.compile(dialect=sqlite.dialect())
    print(f"[SQLAlchemy] Compiled Insert: {compiled_ins}")
    
    # Execute query with parameter bindings
    client.execute(str(compiled_ins), list(compiled_ins.params.values()))
    print(f"[SQLAlchemy] Inserted '{product_name}' successfully")

    # 3. Build select query using SQLAlchemy Core
    sel_stmt = select(products).where(products.c.name == product_name)
    compiled_sel = sel_stmt.compile(dialect=sqlite.dialect())
    print(f"[SQLAlchemy] Compiled Select: {compiled_sel}")

    res = client.execute(str(compiled_sel), list(compiled_sel.params.values()))
    if len(res.rows) == 0:
        raise ValueError("Product not found")

    row = dict(zip(res.columns, res.rows[0]))
    print("[SQLAlchemy] Retrieved record:", row)

    # 4. Build update query using SQLAlchemy Core
    upd_stmt = update(products).where(products.c.name == product_name).values(price=99)
    compiled_upd = upd_stmt.compile(dialect=sqlite.dialect())
    client.execute(str(compiled_upd), list(compiled_upd.params.values()))

    # Verify update
    res_after = client.execute(str(compiled_sel), list(compiled_sel.params.values()))
    updated_row = dict(zip(res_after.columns, res_after.rows[0]))
    print("[SQLAlchemy] Updated record:", updated_row)

    if updated_row["price"] != 99:
        raise ValueError("Price update failed")

    client.close()
    print("✅ [SQLAlchemy] Test passed successfully!")

if __name__ == "__main__":
    main()
