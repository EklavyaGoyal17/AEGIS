import { computeArgumentsDigest } from '@aegis/contracts/crypto';
import { describe, expect, it } from 'vitest';
import { compilePolicySet, evaluate } from '../src/index.js';
import {
  compiled,
  doc,
  exportPolicy,
  exportSet,
  grant,
  input,
  NOW,
  policySet,
  rule,
  TENANT,
  withApproval,
} from './builders.js';

const allowAll = doc([rule({ id: 'allow', effect: 'ALLOW', actions: ['crm.*'], resourceTypes: ['*'] })]);

describe('decision basics', () => {
  it('ALLOWs a small internal export', () => {
    const d = evaluate(exportSet(), input());
    expect(d.effect).toBe('ALLOW');
    expect(d.reasonCodes).toEqual(['POLICY_ALLOW']);
    expect(d.matchedRules.map((m) => m.ruleId)).toEqual(['allow-small-internal-export']);
    expect(d.policyVersion).toMatch(/^r1\.[0-9a-f]{12}$/);
    expect(d.decisionTtlSeconds).toBe(60);
  });

  it('accepts an uncompiled policy set and compiles it (same result)', () => {
    const set = policySet({ 'data-export': exportPolicy });
    expect(evaluate(set, input())).toEqual(evaluate(compiled(set), input()));
  });

  it('default-denies when no rule applies', () => {
    const d = evaluate(exportSet(), input({ request: { ...input().request, action: 'crm.customers.delete' } }));
    expect(d).toMatchObject({ effect: 'DENY', reasonCodes: ['DEFAULT_DENY'], matchedRules: [] });
  });

  it('default-denies for an action no policy mentions, even with a broad grant', () => {
    const set = compiled(policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', actions: ['crm.customers.read'] })]) }));
    expect(evaluate(set, input()).reasonCodes).toEqual(['DEFAULT_DENY']);
  });
});

describe('precedence', () => {
  it('explicit DENY overrides ALLOW within one policy', () => {
    const set = compiled(policySet({
      p: doc([rule({ id: 'allow', effect: 'ALLOW' }), rule({ id: 'deny', effect: 'DENY' })]),
    }));
    expect(evaluate(set, input())).toMatchObject({ effect: 'DENY', reasonCodes: ['EXPLICIT_DENY'] });
  });

  it('explicit DENY in one policy overrides ALLOW in another (conflicting policies)', () => {
    const set = compiled(policySet({
      'a-allow': doc([rule({ id: 'allow', effect: 'ALLOW' })]),
      'z-deny': doc([rule({ id: 'deny', effect: 'DENY' })]),
    }));
    const d = evaluate(set, input());
    expect(d.effect).toBe('DENY');
    expect(d.matchedRules).toEqual([{ policyId: 'z-deny', ruleId: 'deny', effect: 'DENY', indeterminate: false }]);
  });

  it('DENY overrides REQUIRE_APPROVAL, and approvals cannot override DENY', () => {
    const set = compiled(policySet({
      p: doc([rule({ id: 'approve', effect: 'REQUIRE_APPROVAL' }), rule({ id: 'deny', effect: 'DENY' })]),
    }));
    const base = input();
    expect(evaluate(set, base).effect).toBe('DENY');
    const resumed = withApproval(base, { policyVersion: set.policyVersion });
    expect(evaluate(set, resumed)).toMatchObject({ effect: 'DENY', reasonCodes: ['EXPLICIT_DENY'], consumesApprovalId: null });
  });

  it('REQUIRE_APPROVAL overrides ALLOW', () => {
    const set = compiled(policySet({
      p: doc([rule({ id: 'allow', effect: 'ALLOW' }), rule({ id: 'approve', effect: 'REQUIRE_APPROVAL', approval: { ttlSeconds: 600 } })]),
    }));
    expect(evaluate(set, input())).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCodes: ['APPROVAL_REQUIRED'] });
  });

  it('uses the minimum approval TTL and minimum decision TTL across policies', () => {
    const set = compiled(policySet({
      a: doc([rule({ id: 'r1', effect: 'REQUIRE_APPROVAL', approval: { ttlSeconds: 600 } })], { decisionTtlSeconds: 30 }),
      b: doc([rule({ id: 'r2', effect: 'REQUIRE_APPROVAL', approval: { ttlSeconds: 120 } })], { decisionTtlSeconds: 90 }),
    }));
    const d = evaluate(set, input());
    expect(d.approval?.ttlSeconds).toBe(120);
    expect(d.decisionTtlSeconds).toBe(30);
  });
});

describe('approval flow', () => {
  const set = exportSet();
  const bulk = input({}, { recordCount: 15000, destination: 'external' });

  it('requires approval for a bulk external export and returns the binding digest', () => {
    const d = evaluate(set, bulk);
    expect(d).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCodes: ['APPROVAL_REQUIRED'], consumesApprovalId: null });
    expect(d.approval).toEqual({ ttlSeconds: 3600, bindingDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) });
    expect(d.decisionTtlSeconds).toBe(60);
  });

  it('ALLOWs once with a valid, approved, bound approval and asks the server to consume it', () => {
    const d = evaluate(set, withApproval(bulk, {}));
    expect(d).toMatchObject({ effect: 'ALLOW', reasonCodes: ['APPROVAL_SATISFIED'], consumesApprovalId: '3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c' });
  });

  it('bounds the ALLOW TTL by the remaining approval lifetime', () => {
    const d = evaluate(set, withApproval(bulk, { expiresAt: '2026-11-02T10:30:20Z' }));
    expect(d.effect).toBe('ALLOW');
    expect(d.decisionTtlSeconds).toBe(20);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ['pending', { status: 'PENDING', resolution: null }, 'REQUIRE_APPROVAL', 'APPROVAL_PENDING'],
    ['rejected', { status: 'REJECTED' }, 'DENY', 'APPROVAL_REJECTED'],
    ['cancelled', { status: 'CANCELLED' }, 'DENY', 'APPROVAL_REJECTED'],
    ['consumed (replay)', { status: 'CONSUMED' }, 'DENY', 'APPROVAL_ALREADY_CONSUMED'],
    ['expired status', { status: 'EXPIRED' }, 'REQUIRE_APPROVAL', 'APPROVAL_EXPIRED'],
    ['expired by time', { expiresAt: NOW }, 'REQUIRE_APPROVAL', 'APPROVAL_EXPIRED'],
    ['other tenant', { tenantId: 'tnt_evil' }, 'DENY', 'APPROVAL_TENANT_MISMATCH'],
    ['malformed approval record', { resolution: { decision: 'APPROVE', resolvedBy: 'usr_bob', resolvedAt: NOW, comment: null, bindingDigest: 'X' } }, 'DENY', 'INVALID_INPUT'],
    ['APPROVED without resolution', { resolution: null }, 'DENY', 'APPROVAL_BINDING_MISMATCH'],
  ])('%s → %s %s', (_label, change, effect, code) => {
    const d = evaluate(set, withApproval(bulk, change));
    expect(d.effect).toBe(effect);
    expect(d.reasonCodes[0]).toBe(code);
    expect(d.consumesApprovalId).toBeNull();
  });

  it('DENYs self-resolution by the requesting principal or by the agent', () => {
    for (const resolvedBy of ['usr_alice', 'agent-crm']) {
      const base = withApproval(bulk, {});
      const res = { ...base.approval!.resolution!, resolvedBy };
      const d = evaluate(set, { ...base, approval: { ...base.approval!, resolution: res } });
      expect(d.reasonCodes).toEqual(['APPROVAL_SELF_RESOLVED']);
    }
  });

  it('an approval for one set of arguments cannot authorize different arguments', () => {
    const approved = withApproval(bulk, {});
    const swapped = {
      ...approved,
      request: { ...approved.request, argumentsDigest: computeArgumentsDigest({ table: 'customers', limit: 10_000_000 }) },
    };
    expect(evaluate(set, swapped)).toMatchObject({ effect: 'DENY', reasonCodes: ['APPROVAL_BINDING_MISMATCH'] });
  });

  it('an approval for one resource cannot authorize another', () => {
    const approved = withApproval(bulk, {});
    const other = { ...approved.resource, id: 'vip_customers' };
    const d = evaluate(set, { ...approved, resource: other, request: { ...approved.request, resource: other } });
    expect(d.reasonCodes).toEqual(['APPROVAL_BINDING_MISMATCH']);
  });

  it('an approval obtained for another agent or principal cannot be reused', () => {
    const approved = withApproval(bulk, {});
    const otherPrincipal = { ...approved, principal: { ...approved.principal, principalId: 'usr_carol' }, grants: [grant({ delegatorPrincipalId: 'usr_carol' })] };
    expect(evaluate(set, otherPrincipal).reasonCodes).toEqual(['APPROVAL_BINDING_MISMATCH']);
  });

  it('a forged approval id the server could not find is DENY', () => {
    expect(evaluate(set, withApproval(bulk, null)).reasonCodes).toEqual(['APPROVAL_NOT_FOUND']);
  });

  it('an approval record that does not match the requested approval id is DENY', () => {
    const resumed = withApproval(bulk, {});
    const d = evaluate(set, { ...resumed, request: { ...resumed.request, approvalId: '00000000-0000-4000-8000-000000000000' } });
    expect(d.reasonCodes).toEqual(['APPROVAL_NOT_FOUND']);
  });

  it('requires re-approval when the policy version changed since approval', () => {
    const d = evaluate(set, withApproval(bulk, { policyVersion: 'r0.000000000000' }));
    expect(d).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCodes: ['APPROVAL_POLICY_VERSION_CHANGED'] });
  });

  it('ignores an approval when the rules already ALLOW (does not consume it)', () => {
    const d = evaluate(set, withApproval(input(), {}));
    expect(d).toMatchObject({ effect: 'ALLOW', reasonCodes: ['POLICY_ALLOW'], consumesApprovalId: null });
  });
});

describe('tenant isolation', () => {
  it('DENYs when the policy set belongs to another tenant', () => {
    const foreign = compiled(policySet({ p: allowAll }, 'tnt_other'));
    expect(evaluate(foreign, input()).reasonCodes).toEqual(['POLICY_TENANT_MISMATCH']);
  });

  it('DENYs an agent registered in another tenant', () => {
    const i = input();
    expect(evaluate(compiled(policySet({ p: allowAll })), { ...i, agent: { ...i.agent, tenantId: 'tnt_other' } }).reasonCodes).toEqual([
      'AGENT_TENANT_MISMATCH',
    ]);
  });

  it('DENYs a principal from another tenant', () => {
    const i = input();
    expect(evaluate(compiled(policySet({ p: allowAll })), { ...i, principal: { ...i.principal, tenantId: 'tnt_other' } }).reasonCodes).toEqual([
      'PRINCIPAL_TENANT_MISMATCH',
    ]);
  });

  it('ignores grants issued in another tenant', () => {
    const i = input({ grants: [grant({ tenantId: 'tnt_other' })] });
    expect(evaluate(compiled(policySet({ p: allowAll })), i).reasonCodes).toEqual(['DELEGATION_MISSING']);
  });

  it('the same request evaluated against two tenants\' policies yields each tenant\'s own answer', () => {
    const a = compiled(policySet({ p: allowAll }, 'tnt_a'));
    const b = compiled(policySet({ p: doc([rule({ id: 'deny', effect: 'DENY', actions: ['*'], resourceTypes: ['*'] })]) }, 'tnt_b'));
    const forTenant = (t: string) => {
      const i = input({ tenantId: t, grants: [grant({ tenantId: t })] });
      return { ...i, agent: { ...i.agent, tenantId: t }, principal: { ...i.principal, tenantId: t } };
    };
    expect(evaluate(a, forTenant('tnt_a')).effect).toBe('ALLOW');
    expect(evaluate(b, forTenant('tnt_b')).effect).toBe('DENY');
    expect(evaluate(a, forTenant('tnt_b')).reasonCodes).toEqual(['POLICY_TENANT_MISMATCH']);
  });
});

describe('identity', () => {
  const set = compiled(policySet({ p: allowAll }));
  it.each<[string, (i: ReturnType<typeof input>) => unknown, string]>([
    ['agent id mismatch', (i) => ({ ...i, agent: { ...i.agent, agentId: 'agent-other' } }), 'AGENT_IDENTITY_MISMATCH'],
    ['suspended agent', (i) => ({ ...i, agent: { ...i.agent, status: 'SUSPENDED' } }), 'AGENT_INACTIVE'],
    ['revoked agent', (i) => ({ ...i, agent: { ...i.agent, status: 'REVOKED' } }), 'AGENT_INACTIVE'],
    ['disabled principal', (i) => ({ ...i, principal: { ...i.principal, status: 'DISABLED' } }), 'PRINCIPAL_INACTIVE'],
  ])('%s → %s', (_label, mutate, code) => {
    expect(evaluate(set, mutate(input()))).toMatchObject({ effect: 'DENY', reasonCodes: [code] });
  });
});

describe('delegated authority', () => {
  const set = compiled(policySet({ p: allowAll }));
  it.each<[string, Parameters<typeof grant>[0], string]>([
    ['expired', { expiresAt: '2026-11-01T00:00:00Z' }, 'DELEGATION_EXPIRED'],
    ['expires exactly now', { expiresAt: NOW }, 'DELEGATION_EXPIRED'],
    ['not yet valid', { notBefore: '2026-12-01T00:00:00Z' }, 'DELEGATION_NOT_YET_VALID'],
    ['revoked', { revokedAt: '2026-10-01T00:00:00Z' }, 'DELEGATION_REVOKED'],
    ['action not delegated', { actions: ['crm.customers.read'] }, 'DELEGATION_SCOPE_EXCEEDED'],
    ['resource type not delegated', { scopes: [{ resourceType: 'billing.invoice' }] }, 'DELEGATION_SCOPE_EXCEEDED'],
    ['resource id not delegated', { scopes: [{ resourceType: 'crm.customer_table', resourceIds: ['leads'] }] }, 'DELEGATION_SCOPE_EXCEEDED'],
    ['sensitivity above grant', { maxSensitivity: 'internal' }, 'DELEGATION_SENSITIVITY_EXCEEDED'],
    ['granted by another principal', { delegatorPrincipalId: 'usr_mallory' }, 'DELEGATION_MISSING'],
    ['granted to another agent', { agentId: 'agent-other' }, 'DELEGATION_MISSING'],
  ])('%s → %s', (_label, g, code) => {
    expect(evaluate(set, input({ grants: [grant(g)] }))).toMatchObject({ effect: 'DENY', reasonCodes: [code] });
  });

  it('DENYs with no grants at all, even though policy ALLOWs', () => {
    expect(evaluate(set, input({ grants: [] })).reasonCodes).toEqual(['DELEGATION_MISSING']);
  });

  it('a prefix grant is segment-aligned ("crm.*" does not cover "crmx.read")', () => {
    const s = compiled(policySet({ p: doc([rule({ id: 'a', effect: 'ALLOW', actions: ['*'], resourceTypes: ['*'] })]) }));
    const i = input();
    const req = { ...i.request, action: 'crmx.customers.export' };
    expect(evaluate(s, { ...i, request: req }).reasonCodes).toEqual(['DELEGATION_SCOPE_EXCEEDED']);
  });

  it('reports the most specific miss across several grants', () => {
    const grants = [grant({ grantId: 'g-a', actions: ['billing.*'] }), grant({ grantId: 'g-b', expiresAt: '2026-01-02T00:00:00Z' })];
    expect(evaluate(set, input({ grants })).reasonCodes).toEqual(['DELEGATION_EXPIRED']);
  });

  it('one valid grant among invalid ones is sufficient', () => {
    const grants = [grant({ grantId: 'g-a', revokedAt: NOW }), grant({ grantId: 'g-b' })];
    expect(evaluate(set, input({ grants })).effect).toBe('ALLOW');
  });
});

describe('policy validity', () => {
  it('DENYs NO_ACTIVE_POLICY for an empty policy set', () => {
    expect(evaluate(compiled(policySet({})), input()).reasonCodes).toEqual(['NO_ACTIVE_POLICY']);
  });

  it.each<[string, unknown]>([
    ['not an object', 'allow everything'],
    ['missing rules', { tenantId: TENANT, revision: 1, policies: [{ policyId: 'p', version: 1, document: { schemaVersion: 'aegis.policy/v1' } }] }],
    ['unknown effect', policySet({ p: doc([rule({ id: 'r', effect: 'PERMIT' as never })]) })],
    ['duplicate rule ids', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW' }), rule({ id: 'r', effect: 'DENY' })]) })],
    ['duplicate policy ids', { tenantId: TENANT, revision: 1, policies: [{ policyId: 'p', version: 1, document: allowAll }, { policyId: 'p', version: 2, document: allowAll }] }],
    ['approval on an ALLOW rule', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', approval: { ttlSeconds: 600 } })]) })],
    ['empty sensitivity range', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', sensitivity: { min: 'restricted', max: 'public' } })]) })],
    ['empty time window', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', timeWindows: [{ days: ['MON'], start: '18:00', end: '09:00', utcOffset: '+00:00' }] })]) })],
    ['"values" used outside "in"', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', when: { eq: [{ ref: 'resource.id' }, { values: ['a'] }] } })]) })],
    ['executable expression', policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', when: { js: 'true' } as never })]) })],
  ])('rejects invalid policy (%s) and DENYs POLICY_INVALID', (_label, set) => {
    expect(compilePolicySet(set).ok).toBe(false);
    expect(evaluate(set, input())).toMatchObject({ effect: 'DENY', reasonCodes: ['POLICY_INVALID'] });
  });

  it('rejects conditions nested deeper than the limit', () => {
    let when: Record<string, unknown> = { exists: 'resource.id' };
    for (let i = 0; i < 9; i++) when = { not: when };
    const c = compilePolicySet(policySet({ p: doc([rule({ id: 'r', effect: 'ALLOW', when: when as never })]) }));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.issues.map((i) => i.code)).toContain('CONDITION_TOO_DEEP');
  });

  it('does not freeze or mutate the caller\'s policy objects', () => {
    const set = policySet({ p: allowAll });
    const before = JSON.stringify(set);
    compilePolicySet(set);
    expect(Object.isFrozen(set.policies[0]!.document.rules[0])).toBe(false);
    expect(JSON.stringify(set)).toBe(before);
  });

  it('policyVersion changes when any rule changes and is stable otherwise', () => {
    const v1 = compiled(policySet({ p: allowAll })).policyVersion;
    expect(compiled(policySet({ p: allowAll })).policyVersion).toBe(v1);
    const changed = doc([rule({ id: 'allow', effect: 'ALLOW', actions: ['crm.*'], resourceTypes: ['crm.customer_table'] })]);
    expect(compiled(policySet({ p: changed })).policyVersion).not.toBe(v1);
    expect(compiled(policySet({ p: allowAll }, TENANT, 2)).policyVersion).toMatch(/^r2\./);
  });

  it('DENYs POLICY_VERSION_MISMATCH when the caller pins a different version', () => {
    const set = exportSet();
    expect(evaluate(set, input({ expectedPolicyVersion: 'r1.000000000000' })).reasonCodes).toEqual(['POLICY_VERSION_MISMATCH']);
    expect(evaluate(set, input({ expectedPolicyVersion: set.policyVersion })).effect).toBe('ALLOW');
  });
});

describe('unsupported actions', () => {
  it('DENYs an action outside the action catalog even if a wildcard rule would allow it', () => {
    const set = compiled(policySet({
      p: doc([rule({ id: 'a', effect: 'ALLOW', actions: ['crm.*'] })], { actionCatalog: ['crm.customers.read'] }),
    }));
    expect(evaluate(set, input()).reasonCodes).toEqual(['ACTION_UNSUPPORTED']);
  });
});

describe('malformed input fails closed', () => {
  const set = exportSet();
  it.each<[string, (i: ReturnType<typeof input>) => unknown]>([
    ['resource differs from request', (i) => ({ ...i, resource: { ...i.resource, id: 'other' } })],
    ['nested attribute object', (i) => ({ ...i, resource: { ...i.resource, attributes: { recordCount: { $gt: 0 } } } })],
    ['non-UTC now', (i) => ({ ...i, now: '2026-11-02T10:30:00+01:00' })],
    ['impossible date', (i) => ({ ...i, now: '2026-02-30T10:30:00Z' })],
    ['missing grants', ({ grants: _g, ...rest }) => rest],
    ['unknown top-level field', (i) => ({ ...i, isAdmin: true })],
    ['too many grants', (i) => ({ ...i, grants: Array.from({ length: 65 }, (_, n) => grant({ grantId: `g${n}` })) })],
    ['NaN attribute', (i) => ({ ...i, environment: { x: Number.NaN } })],
    ['null', () => null],
    ['a function', () => () => 1],
    ['a proxy', (i) => new Proxy(i, {})],
  ])('%s → DENY INVALID_INPUT', (_label, mutate) => {
    expect(evaluate(set, mutate(input()))).toMatchObject({ effect: 'DENY', reasonCodes: ['INVALID_INPUT'] });
  });

  it('evaluates a snapshot: getters cannot change values after validation (TOCTOU)', () => {
    let reads = 0;
    const i = input({}, { recordCount: 15000 });
    const attrs = { ...i.resource.attributes };
    Object.defineProperty(attrs, 'recordCount', {
      enumerable: true,
      get: () => (++reads === 1 ? 10 : 15000), // looks small when validated, large afterwards
    });
    const tricky = { ...i, resource: { ...i.resource, attributes: attrs } };
    const d = evaluate(set, tricky);
    // The snapshot sees 10 (first read) consistently; no read after the snapshot happens.
    expect(reads).toBe(1);
    expect(d.reasonCodes[0]).not.toBe('INTERNAL_ERROR');
  });
});

describe('three-valued conditions', () => {
  it('a missing attribute does not satisfy an ALLOW condition', () => {
    const i = input();
    const attrs = { ...i.resource.attributes } as Record<string, unknown>;
    delete attrs['recordCount'];
    const r = { ...i.resource, attributes: attrs };
    const d = evaluate(exportSet(), { ...i, resource: r, request: { ...i.request, resource: r } } as never);
    // ALLOW rule is UNKNOWN (not applied); approval rule `any(gt UNKNOWN, ne FALSE)` = UNKNOWN → applies.
    expect(d).toMatchObject({ effect: 'REQUIRE_APPROVAL', reasonCodes: ['APPROVAL_REQUIRED', 'CONDITION_INDETERMINATE'] });
  });

  it('a missing attribute makes a DENY condition apply (fail-safe)', () => {
    const set = compiled(policySet({
      p: doc([
        rule({ id: 'allow', effect: 'ALLOW' }),
        rule({ id: 'deny-external', effect: 'DENY', when: { eq: [{ ref: 'resource.attributes.region' }, { value: 'external' }] } }),
      ]),
    }));
    expect(evaluate(set, input())).toMatchObject({ effect: 'DENY', reasonCodes: ['EXPLICIT_DENY', 'CONDITION_INDETERMINATE'] });
    expect(evaluate(set, input({}, { region: 'eu' })).effect).toBe('ALLOW');
  });

  it('never coerces types ("500" is not 500)', () => {
    const d = evaluate(exportSet(), input({}, { recordCount: '500' }));
    expect(d.effect).not.toBe('ALLOW');
  });

  it('missing sensitivity is treated as restricted', () => {
    const i = input();
    const attrs = { ...i.resource.attributes } as Record<string, unknown>;
    delete attrs['sensitivity'];
    const r = { ...i.resource, attributes: attrs };
    const d = evaluate(exportSet(), { ...i, resource: r, request: { ...i.request, resource: r } } as never);
    expect(d.reasonCodes).toEqual(['DELEGATION_SENSITIVITY_EXCEEDED']);
  });

  it('an unrecognised sensitivity label is treated as restricted', () => {
    const set = compiled(policySet({ p: allowAll }));
    expect(evaluate(set, input({ grants: [grant({ maxSensitivity: 'restricted' })] }, { sensitivity: 'PUBLIC' })).effect).toBe('ALLOW');
    const deny = compiled(policySet({ p: exportPolicy }));
    expect(evaluate(deny, input({ grants: [grant({ maxSensitivity: 'restricted' })] }, { sensitivity: 'PUBLIC' })).reasonCodes).toEqual(['EXPLICIT_DENY']);
  });

  it('inherited object members are never attributes', () => {
    const set = compiled(policySet({
      p: doc([rule({ id: 'allow', effect: 'ALLOW', when: { exists: 'request.context.constructor' } })]),
    }));
    expect(evaluate(set, input()).reasonCodes).toEqual(['DEFAULT_DENY']);
  });
});

describe('time windows', () => {
  const windowed = (utcOffset: string) =>
    compiled(policySet({
      p: doc([rule({ id: 'hours', effect: 'ALLOW', timeWindows: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], start: '09:00', end: '17:00', utcOffset }] })]),
    }));

  it.each<[string, string, string]>([
    ['inside UTC window', '+00:00', 'ALLOW'],
    ['10:30Z is 16:00 in +05:30 (inside)', '+05:30', 'ALLOW'],
    ['10:30Z is 17:30 in +07:00 (outside)', '+07:00', 'DENY'],
    ['10:30Z is 05:30 in -05:00 (outside)', '-05:00', 'DENY'],
  ])('%s', (_label, offset, effect) => {
    expect(evaluate(windowed(offset), input()).effect).toBe(effect);
  });

  it('end is exclusive and weekends are excluded', () => {
    expect(evaluate(windowed('+00:00'), input({ now: '2026-11-02T17:00:00Z' })).effect).toBe('DENY');
    expect(evaluate(windowed('+00:00'), input({ now: '2026-11-02T16:59:59.999Z' })).effect).toBe('ALLOW');
    expect(evaluate(windowed('+00:00'), input({ now: '2026-11-01T10:30:00Z' })).effect).toBe('DENY'); // Sunday
  });

  it('a day boundary crossing via offset uses the local day', () => {
    // 2026-11-06 Fri 20:00Z is Sat 01:30 in +05:30.
    expect(evaluate(windowed('+05:30'), input({ now: '2026-11-06T20:00:00Z' })).effect).toBe('DENY');
  });
});

describe('fail-closed resource limits', () => {
  it('DENYs EVALUATION_BUDGET_EXCEEDED when the step budget is exhausted', () => {
    expect(evaluate(exportSet(), input(), { maxSteps: 5 })).toMatchObject({
      effect: 'DENY',
      reasonCodes: ['EVALUATION_BUDGET_EXCEEDED'],
    });
  });

  it('every policy set that compiles evaluates within the default budget (worst case)', () => {
    const big: Record<string, ReturnType<typeof doc>> = {};
    const values = Array.from({ length: 256 }, (_, n) => `v${n}`);
    for (let p = 0; p < 2; p++) {
      big[`p${p}`] = doc(
        Array.from({ length: 50 }, (_, r) =>
          rule({ id: `r${r}`, effect: 'ALLOW', actions: ['crm.*', '*'], resourceTypes: ['*'], when: { in: [{ ref: 'resource.id' }, { values }] } }),
        ),
      );
    }
    const c = compilePolicySet(policySet(big));
    expect(c.ok).toBe(true);
    const d = evaluate(c, input({ grants: Array.from({ length: 64 }, (_, n) => grant({ grantId: `g${n}`, actions: ['billing.x'] }) ) }));
    expect(d.reasonCodes).toEqual(['DELEGATION_SCOPE_EXCEEDED']);
    const allowed = evaluate(c, input());
    expect(allowed.reasonCodes).not.toContain('EVALUATION_BUDGET_EXCEEDED');
  });

  it('rejects policy sets whose worst-case cost exceeds the static bound', () => {
    const values = Array.from({ length: 256 }, (_, n) => `v${n}`);
    const heavy = doc(
      Array.from({ length: 256 }, (_, r) => rule({ id: `r${r}`, effect: 'ALLOW', when: { in: [{ ref: 'resource.id' }, { values }] } })),
    );
    const c = compilePolicySet(policySet({ heavy }));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.issues.map((i) => i.code)).toContain('POLICY_TOO_COMPLEX');
  });
});

describe('traces', () => {
  it('are deterministic and contain identifiers and codes only, never request values', () => {
    const secret = 'sk_live_SUPER_SECRET_VALUE';
    const i = input();
    const req = { ...i.request, context: { note: secret } };
    const d1 = evaluate(exportSet(), { ...i, request: req });
    const d2 = evaluate(exportSet(), { ...i, request: req });
    expect(d1).toEqual(d2);
    expect(JSON.stringify(d1)).not.toContain(secret);
    expect(JSON.stringify(d1.trace)).not.toContain('customers');
    expect(d1.trace.at(-1)).toEqual({ step: 'combine', outcome: 'RESULT', code: 'POLICY_ALLOW' });
  });
});
