import { generateKeyPairSync, createPrivateKey, sign as edSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/index.js';
import {
  computeApprovalBindingDigest,
  computeAttributesDigest,
  computeArgumentsDigest,
  computeAuditEventHash,
  InMemoryReplayStore,
  mintExecutionAuthorization,
  verifyAuditChain,
  verifyExecutionAuthorization,
  type MintClaimsInput,
  type ExpectedExecution,
  type VerifyOptions,
} from '../src/crypto/index.js';
import { loadExamples } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const other = generateKeyPairSync('ed25519');
const NOW = new Date('2026-11-02T18:30:00Z');
const args = { table: 'customers', limit: 10 };

const claims: MintClaimsInput = {
  iss: 'aegis-decision-service',
  aud: 'crm-tool-gateway',
  tid: 'tnt_acme',
  sub: 'agent-1',
  prn: 'usr_alice',
  act: 'crm.customers.export',
  res: { type: 'crm.customer_table', id: 'customers' },
  args: computeArgumentsDigest(args),
  att: computeAttributesDigest({ recordCount: 10 }),
  dec: '7b6a5948-3726-4154-a3b2-c1d0e9f8a7b6',
  apr: null,
  pv: 'r1.abc',
};

const expected: ExpectedExecution = {
  audience: 'crm-tool-gateway',
  tenantId: 'tnt_acme',
  agentId: 'agent-1',
  action: 'crm.customers.export',
  resource: { type: 'crm.customer_table', id: 'customers' },
  argumentsDigest: computeArgumentsDigest(args),
};

function opts(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  return {
    keys: new Map([['k1', publicKey]]),
    expected,
    replayStore: new InMemoryReplayStore(),
    now: NOW,
    ...overrides,
  };
}

const mint = (over: Partial<MintClaimsInput> = {}, lifetimeSeconds = 60) =>
  mintExecutionAuthorization({ ...claims, ...over }, { privateKey, kid: 'k1', now: NOW, lifetimeSeconds }).token;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('execution authorization', () => {
  it('verifies a freshly minted token and binds all claims', async () => {
    const result = await verifyExecutionAuthorization(mint(), opts());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.exp - result.claims.iat).toBe(60);
  });

  it('is single-use: the second presentation is rejected as a replay', async () => {
    const token = mint();
    const o = opts();
    expect((await verifyExecutionAuthorization(token, o)).ok).toBe(true);
    expect(await verifyExecutionAuthorization(token, o)).toEqual({ ok: false, reason: 'REPLAYED' });
  });

  it('does not burn the jti when another check fails', async () => {
    const token = mint();
    const o = opts();
    const wrong = await verifyExecutionAuthorization(token, { ...o, expected: { ...expected, action: 'crm.customers.delete' } });
    expect(wrong.ok).toBe(false);
    expect((await verifyExecutionAuthorization(token, o)).ok).toBe(true);
  });

  it.each<[string, Partial<ExpectedExecution>, string]>([
    ['tenant', { tenantId: 'tnt_other' }, 'tid'],
    ['agent', { agentId: 'agent-2' }, 'sub'],
    ['action', { action: 'crm.customers.delete' }, 'act'],
    ['resource type', { resource: { type: 'crm.other', id: 'customers' } }, 'res.type'],
    ['resource id', { resource: { type: 'crm.customer_table', id: 'vip' } }, 'res.id'],
    ['arguments', { argumentsDigest: computeArgumentsDigest({ ...args, limit: 1_000_000 }) }, 'args'],
    ['arguments missing', { argumentsDigest: null }, 'args'],
    ['claimed attributes (gateway re-derived a different recordCount)', { attributesDigest: computeAttributesDigest({ recordCount: 15000 }) }, 'att'],
  ])('rejects a %s binding mismatch', async (_label, change, field) => {
    const result = await verifyExecutionAuthorization(mint(), opts({ expected: { ...expected, ...change } }));
    expect(result).toEqual({ ok: false, reason: 'BINDING_MISMATCH', field });
  });

  it('rejects a principal mismatch when the enforcement point pins the principal', async () => {
    const result = await verifyExecutionAuthorization(mint(), opts({ expected: { ...expected, principalId: 'usr_mallory' } }));
    expect(result).toEqual({ ok: false, reason: 'BINDING_MISMATCH', field: 'prn' });
  });

  it('rejects the wrong audience', async () => {
    const result = await verifyExecutionAuthorization(mint(), opts({ expected: { ...expected, audience: 'billing-gateway' } }));
    expect(result.ok ? 'ok' : result.reason).toBe('AUDIENCE_MISMATCH');
  });

  it('enforces expiry and not-before with bounded skew', async () => {
    const token = mint();
    const at = (s: number) => opts({ now: new Date(NOW.getTime() + s * 1000) });
    expect((await verifyExecutionAuthorization(token, at(60 + 29))).ok).toBe(true);
    expect(await verifyExecutionAuthorization(mint(), at(60 + 30))).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(await verifyExecutionAuthorization(mint(), at(-31))).toEqual({ ok: false, reason: 'NOT_YET_VALID' });
  });

  it('refuses to mint or accept lifetimes above the cap', async () => {
    expect(() => mint({}, 301)).toThrow(RangeError);
    const token = mint({}, 300);
    expect(await verifyExecutionAuthorization(token, opts({ maxLifetimeSeconds: 120 }))).toEqual({
      ok: false,
      reason: 'LIFETIME_TOO_LONG',
    });
  });

  it('rejects tokens signed by an unknown key or with a kid that is not configured', async () => {
    const forged = mintExecutionAuthorization(claims, { privateKey: other.privateKey, kid: 'k1', now: NOW }).token;
    expect(await verifyExecutionAuthorization(forged, opts())).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    const unknownKid = mintExecutionAuthorization(claims, { privateKey, kid: 'k2', now: NOW }).token;
    expect(await verifyExecutionAuthorization(unknownKid, opts())).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
  });

  it('rejects a payload modified after signing', async () => {
    const [h, p, s] = mint().split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.act = 'crm.customers.delete';
    const tampered = `${h}.${b64(payload)}.${s}`;
    expect(await verifyExecutionAuthorization(tampered, opts({ expected: { ...expected, action: 'crm.customers.delete' } }))).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it.each([
    ['alg none', { alg: 'none', typ: 'aegis-ea+jwt', kid: 'k1' }],
    ['alg HS256', { alg: 'HS256', typ: 'aegis-ea+jwt', kid: 'k1' }],
    ['wrong typ', { alg: 'EdDSA', typ: 'JWT', kid: 'k1' }],
    ['extra header (jku)', { alg: 'EdDSA', typ: 'aegis-ea+jwt', kid: 'k1', jku: 'https://evil.example/keys' }],
  ])('rejects header: %s', async (_label, header) => {
    const [, p, s] = mint().split('.');
    const result = await verifyExecutionAuthorization(`${b64(header)}.${p}.${s}`, opts());
    expect(result).toEqual({ ok: false, reason: 'UNSUPPORTED_HEADER' });
  });

  it('rejects validly signed tokens with unexpected claims', async () => {
    const header = { alg: 'EdDSA', kid: 'k1', typ: 'aegis-ea+jwt' };
    const bad = { ...claims, v: 1, jti: 'not-a-uuid', iat: 1, nbf: 1, exp: 2 };
    const input = `${b64(header)}.${b64(bad)}`;
    const sig = edSign(null, Buffer.from(input), createPrivateKey(privateKey.export({ format: 'pem', type: 'pkcs8' })));
    expect(await verifyExecutionAuthorization(`${input}.${sig.toString('base64url')}`, opts())).toEqual({
      ok: false,
      reason: 'INVALID_CLAIMS',
    });
  });

  it.each([
    ['non-string', 42],
    ['empty', ''],
    ['two segments', 'a.b'],
    ['padding chars', 'a=.b.c'],
    ['oversized', 'a'.repeat(5000)],
  ])('rejects malformed token: %s', async (_label, token) => {
    expect(await verifyExecutionAuthorization(token, opts())).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects non-canonical base64url signature encodings', async () => {
    const token = mint();
    const [h, p, s] = token.split('.');
    // Flip the unused low bits of the final character: decodes to the same bytes, different text.
    const last = s!.at(-1)!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const idx = alphabet.indexOf(last);
    const twin = alphabet[(idx & ~0b1111) | ((idx + 1) & 0b1111)]!;
    const mutated = `${h}.${p}.${s!.slice(0, -1)}${twin}`;
    const result = await verifyExecutionAuthorization(mutated, opts());
    expect(result.ok).toBe(false);
  });

  it('honours revocation checks', async () => {
    const result = await verifyExecutionAuthorization(mint(), opts({ isRevoked: (c) => c.sub === 'agent-1' }));
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('fails closed when a dependency throws', async () => {
    const result = await verifyExecutionAuthorization(mint(), opts({
      replayStore: { consume: () => { throw new Error('redis down'); } },
    }));
    expect(result).toEqual({ ok: false, reason: 'VERIFIER_ERROR' });
  });

  it('in-memory replay store fails closed when full', () => {
    const store = new InMemoryReplayStore(1);
    expect(store.consume('a', 100, 0)).toBe(true);
    expect(store.consume('b', 100, 0)).toBe(false);
    // ...and frees capacity only once the verifier's clock passes the entry's expiry.
    expect(store.consume('b', 200, 101)).toBe(true);
    expect(store.consume('b', 200, 150)).toBe(false);
  });

  it('a replay is rejected even when the verifier clock is far from the wall clock', async () => {
    const token = mint();
    // The injected clock is inside the token's validity window but far from Date.now().
    const inWindow = opts({ now: new Date(NOW.getTime() + 10_000), replayStore: new InMemoryReplayStore() });
    expect((await verifyExecutionAuthorization(token, inWindow)).ok).toBe(true);
    expect(await verifyExecutionAuthorization(token, inWindow)).toEqual({ ok: false, reason: 'REPLAYED' });
  });

  it('refuses to mint with a non-Ed25519 key', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(() => mintExecutionAuthorization(claims, { privateKey: rsa.privateKey, kid: 'k1' })).toThrow(TypeError);
  });
});

describe('approval binding digest', () => {
  const base = {
    tenantId: 'tnt_acme',
    agentId: 'agent-1',
    principalId: 'usr_alice',
    action: 'crm.customers.export',
    resource: { type: 'crm.customer_table', id: 'customers' },
    argumentsDigest: computeArgumentsDigest(args),
  };

  it.each<[string, Partial<typeof base>]>([
    ['tenant', { tenantId: 'tnt_other' }],
    ['agent', { agentId: 'agent-2' }],
    ['principal', { principalId: 'usr_mallory' }],
    ['action', { action: 'crm.customers.delete' }],
    ['resource', { resource: { type: 'crm.customer_table', id: 'vip' } }],
    ['arguments', { argumentsDigest: computeArgumentsDigest({ limit: 1 }) }],
  ])('changes when the %s changes', (_label, change) => {
    expect(computeApprovalBindingDigest({ ...base, ...change })).not.toBe(computeApprovalBindingDigest(base));
  });

  it('ignores resource attributes (they are not part of what is approved)', () => {
    const withAttrs = { ...base, resource: { ...base.resource, attributes: { recordCount: 5 } } };
    expect(computeApprovalBindingDigest(withAttrs)).toBe(computeApprovalBindingDigest(base));
  });

  it('matches the published examples', () => {
    const ex = loadExamples() as Record<string, any>;
    const approval = ex['approval-request-approved'];
    expect(
      computeApprovalBindingDigest({
        tenantId: approval.tenantId,
        agentId: approval.agentId,
        principalId: approval.requestingPrincipalId,
        action: approval.action,
        resource: approval.resource,
        argumentsDigest: approval.argumentsDigest,
      }),
    ).toBe(approval.bindingDigest);
    expect(approval.resolution.bindingDigest).toBe(approval.bindingDigest);
    expect(ex['resolve-approval-request'].expectedBindingDigest).toBe(approval.bindingDigest);
    expect(computeArgumentsDigest(ex['tool-arguments'])).toBe(ex['evaluate-request'].argumentsDigest);
  });
});

describe('audit hash chain', () => {
  const events = (loadExamples()['audit-event-page'] as { items: AuditEvent[] }).items;

  it('the published example chain verifies', () => {
    expect(verifyAuditChain(events)).toEqual({ ok: true });
  });

  it('detects modification', () => {
    const tampered = structuredClone(events);
    tampered[0]!.effect = 'ALLOW';
    expect(verifyAuditChain(tampered)).toEqual({ ok: false, index: 0, reason: 'HASH_MISMATCH' });
  });

  it('detects modification even if the attacker recomputes that event hash', () => {
    const tampered = structuredClone(events);
    tampered[0]!.effect = 'ALLOW';
    tampered[0]!.eventHash = computeAuditEventHash(tampered[0]!);
    expect(verifyAuditChain(tampered)).toEqual({ ok: false, index: 1, reason: 'BROKEN_LINK' });
  });

  it('detects deletion and reordering', () => {
    expect(verifyAuditChain([events[1]!])).toEqual({ ok: false, index: 0, reason: 'BROKEN_LINK' });
    expect(verifyAuditChain([events[1]!, events[0]!])).toMatchObject({ ok: false });
  });

  it('verifies a slice given its anchor', () => {
    expect(verifyAuditChain([events[1]!], events[0]!.eventHash)).toEqual({ ok: true });
  });
});
