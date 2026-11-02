import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createHash } from 'node:crypto';

export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('aegis-migrations'))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const source = await readFile(
      new URL(
        import.meta.url.includes('/dist/')
          ? '../../db/001_authorization.sql'
          : './001_authorization.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const digest = createHash('sha256').update(source).digest('hex');
    const result = await client.query<{ digest: string }>(
      'SELECT digest FROM schema_migrations WHERE version=$1',
      ['001'],
    );
    if (result.rows[0] && result.rows[0].digest !== digest)
      throw new Error('Migration checksum mismatch');
    if (!result.rowCount) {
      await client.query(source);
      await client.query(
        'INSERT INTO schema_migrations(version,digest) VALUES ($1,$2)',
        ['001', digest],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
