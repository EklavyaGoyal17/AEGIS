import { expect, test, vi } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import {
  canonical,
  digest,
  evaluationSchema,
  UnavailablePolicyEngine,
} from '../src/domain.js';
import { authenticateBearer } from '../src/identity.js';
import { Store } from '../src/store.js';
import pg from 'pg';

test('canonical digests bind values and ignore object insertion order', () => {
  expect(canonical({ z: [1, 2], a: { y: true, x: null } })).toBe(
    '{"a":{"x":null,"y":true},"z":[1,2]}',
  );
  expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
  expect(digest({ a: [1, 2] })).not.toBe(digest({ a: [2, 1] }));
  expect(() => canonical({ bad: undefined })).toThrow();
});
test('temporary production adapter always fails closed', async () => {
  const engine = new UnavailablePolicyEngine();
  const base = {
    tenantId: 'test',
    principal: {} as never,
    request: {} as never,
    signal: new AbortController().signal,
  };
  expect((await engine.evaluate({ ...base, policy: null })).effect).toBe(
    'DENY',
  );
  await expect(
    engine.evaluate({ ...base, policy: { version: 'v1', document: {} } }),
  ).rejects.toThrow('POLICY_ENGINE_UNAVAILABLE');
  expect(await engine.validatePolicy()).toBe(false);
});
test('body cannot provide tenant or principal authority', () => {
  expect(
    evaluationSchema.safeParse({ tenantId: 'forged', requestId: 'bad' })
      .success,
  ).toBe(false);
});
test('JWT verification fails before identity lookup on an invalid signature', async () => {
  const keys = await generateKeyPair('RS256');
  const wrong = await generateKeyPair('RS256');
  const pool = new pg.Pool();
  const store = new Store(pool);
  const lookup = vi.spyOn(store, 'authenticate');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('machine')
    .setIssuer('https://issuer.test')
    .setAudience('aegis')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(wrong.privateKey);
  await expect(
    authenticateBearer(
      `Bearer ${token}`,
      { issuer: 'https://issuer.test', audience: 'aegis', key: keys.publicKey },
      store,
    ),
  ).rejects.toThrow('INVALID_CREDENTIALS');
  expect(lookup).not.toHaveBeenCalled();
  await pool.end();
});
