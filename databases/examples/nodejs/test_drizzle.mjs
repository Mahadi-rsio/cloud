import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { eq } from 'drizzle-orm';

const url = process.env.DB_URL || 'http://test_user.localhost:8080';
const authToken = process.env.DB_TOKEN;

if (!authToken) {
  console.error('Error: DB_TOKEN environment variable is required');
  process.exit(1);
}

console.log(`[Drizzle ORM] Connecting to ${url}...`);

const client = createClient({
  url,
  authToken,
});

const users = sqliteTable('drizzle_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role').notNull().default('user'),
  createdAt: text('created_at').notNull(),
});

const db = drizzle(client);

async function main() {
  // 1. Ensure table exists
  await client.execute(`
    CREATE TABLE IF NOT EXISTS drizzle_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
  `);

  const uniqueEmail = `alice_${Date.now()}@example.com`;

  // 2. Insert record via Drizzle ORM
  console.log(`[Drizzle ORM] Inserting user ${uniqueEmail}...`);
  await db.insert(users).values({
    name: 'Alice Cooper',
    email: uniqueEmail,
    role: 'developer',
    createdAt: new Date().toISOString(),
  });

  // 3. Select record via Drizzle ORM
  console.log(`[Drizzle ORM] Querying users...`);
  const results = await db.select().from(users).where(eq(users.email, uniqueEmail));
  console.log('[Drizzle ORM] Retrieved:', results);

  if (results.length === 0 || results[0].email !== uniqueEmail) {
    throw new Error('Drizzle ORM query validation failed');
  }

  // 4. Update record via Drizzle ORM
  await db.update(users).set({ role: 'lead-architect' }).where(eq(users.email, uniqueEmail));
  const updated = await db.select().from(users).where(eq(users.email, uniqueEmail));
  console.log('[Drizzle ORM] Updated record:', updated);

  console.log('✅ [Drizzle ORM] Test passed successfully!');
}

main().catch((err) => {
  console.error('❌ [Drizzle ORM] Test failed:', err);
  process.exit(1);
});
