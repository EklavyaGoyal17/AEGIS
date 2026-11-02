import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { digest, DomainError } from './domain.js';
const cursorSchema = z
  .object({
    v: z.literal(1),
    t: z.uuid(),
    k: z.string(),
    f: z.string(),
    a: z.string(),
    e: z.number().int(),
  })
  .strict();
export class Cursors {
  constructor(private readonly secret: string) {
    if (secret.length < 32)
      throw new Error('CURSOR_SIGNING_KEY must be at least 32 characters');
  }
  encode(tenant: string, kind: string, filters: unknown, after: string) {
    const body = Buffer.from(
      JSON.stringify({
        v: 1,
        t: tenant,
        k: kind,
        f: digest(filters),
        a: after,
        e: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }
  decode(
    cursor: string | undefined,
    tenant: string,
    kind: string,
    filters: unknown,
  ): string | undefined {
    if (!cursor) return undefined;
    try {
      if (cursor.length > 512) throw new Error();
      const [body, signature, extra] = cursor.split('.');
      if (!body || !signature || extra) throw new Error();
      const expected = createHmac('sha256', this.secret).update(body).digest();
      const received = Buffer.from(signature, 'base64url');
      if (
        received.length !== expected.length ||
        !timingSafeEqual(received, expected)
      )
        throw new Error();
      const value = cursorSchema.parse(
        JSON.parse(Buffer.from(body, 'base64url').toString('utf8')),
      );
      if (
        value.t !== tenant ||
        value.k !== kind ||
        value.f !== digest(filters) ||
        value.e <= Date.now() / 1000
      )
        throw new Error();
      return value.a;
    } catch {
      throw new DomainError(400, 'INVALID_CURSOR');
    }
  }
}
