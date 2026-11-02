import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { digest } from '../../api/src/domain.js';

const inputSchema = z
  .object({
    executionId: z.uuid(),
    tenantId: z.uuid(),
    noteId: z.string().min(1).max(256),
    text: z.string().min(1).max(4096),
  })
  .strict();
export async function buildDemoTool(pool: pg.Pool, secret: string) {
  if (secret.length < 32) throw new Error('Demo connector secret too short');
  await pool.query(`CREATE TABLE IF NOT EXISTS demo_notes (
    tenant_id uuid NOT NULL, note_id text NOT NULL, execution_id uuid NOT NULL UNIQUE,
    payload_digest text NOT NULL, note_text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,note_id))`);
  const app = Fastify({ bodyLimit: 8192, logger: false });
  app.post('/internal/notes', async (request, reply) => {
    const token = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (token.length !== expected.length || !timingSafeEqual(token, expected))
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const parsed = inputSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'INVALID_INPUT' });
    const body = parsed.data;
    const result = await pool.query(
      `INSERT INTO demo_notes(tenant_id,note_id,execution_id,payload_digest,note_text) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING RETURNING execution_id`,
      [body.tenantId, body.noteId, body.executionId, digest(body), body.text],
    );
    if (!result.rowCount) {
      const existing = (
        await pool.query(
          'SELECT payload_digest FROM demo_notes WHERE execution_id=$1',
          [body.executionId],
        )
      ).rows[0];
      if (existing?.payload_digest !== digest(body))
        return reply.code(409).send({ error: 'IDEMPOTENCY_CONFLICT' });
    }
    return reply.code(201).send({ status: 'created' });
  });
  return app;
}
