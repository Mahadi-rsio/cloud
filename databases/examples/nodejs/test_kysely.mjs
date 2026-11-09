import { Kysely } from 'kysely';
import { LibsqlDialect } from '@libsql/kysely-libsql';

const url = process.env.DB_URL || 'http://test_user.localhost:8080';
const authToken = process.env.DB_TOKEN;

if (!authToken) {
  console.error('Error: DB_TOKEN environment variable is required');
  process.exit(1);
}

console.log(`[Kysely] Connecting to ${url}...`);

const db = new Kysely({
  dialect: new LibsqlDialect({
    url,
    authToken,
  }),
});

async function main() {
  // 1. Create table
  await db.schema
    .createTable('kysely_posts')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('views', 'integer', (col) => col.defaultTo(0).notNull())
    .execute();

  const title = `Post #${Date.now()}`;

  // 2. Insert record
  console.log(`[Kysely] Inserting post "${title}"...`);
  const inserted = await db
    .insertInto('kysely_posts')
    .values({
      title,
      content: 'Multi-tenant SQLite / LibSQL works smoothly with Kysely query builder!',
      views: 10,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  console.log('[Kysely] Inserted record:', inserted);

  // 3. Query record
  console.log('[Kysely] Querying posts...');
  const post = await db
    .selectFrom('kysely_posts')
    .selectAll()
    .where('id', '=', inserted.id)
    .executeTakeFirstOrThrow();

  console.log('[Kysely] Retrieved:', post);

  // 4. Update record
  await db
    .updateTable('kysely_posts')
    .set({ views: post.views + 1 })
    .where('id', '=', inserted.id)
    .execute();

  const updated = await db
    .selectFrom('kysely_posts')
    .selectAll()
    .where('id', '=', inserted.id)
    .executeTakeFirstOrThrow();

  console.log('[Kysely] Updated views to:', updated.views);

  await db.destroy();
  console.log('✅ [Kysely] Test passed successfully!');
}

main().catch((err) => {
  console.error('❌ [Kysely] Test failed:', err);
  process.exit(1);
});
