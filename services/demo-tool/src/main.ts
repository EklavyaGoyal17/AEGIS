import pg from 'pg';
import { buildDemoTool } from './app.js';
if (!process.env.DATABASE_URL || !process.env.DEMO_TOOL_SECRET)
  throw new Error('Demo DB and connector secret required');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 3000,
  statement_timeout: 3000,
});
const app = await buildDemoTool(pool, process.env.DEMO_TOOL_SECRET);
app.get('/health', async () => ({ status: 'ok' }));
await app.listen({
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3002),
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
