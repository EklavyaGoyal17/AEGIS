import pg from 'pg';
import { Store, verifyAudit } from '../services/api/src/store.js';
import { z } from 'zod';
const tenant = z.uuid().parse(process.argv[2]);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const valid = await verifyAudit(new Store(pool), tenant);
  console.log(JSON.stringify({ tenantId: tenant, valid }));
  if (!valid) process.exitCode = 1;
} finally {
  await pool.end();
}
