import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBackendPolicyEngine, detectConflicts, evaluate, simulate, type LoadedContext } from '../src/index.js';
import { compiled, doc, exportPolicy, exportSet, input, policySet, rule, TENANT, withApproval } from './builders.js';

describe('detectConflicts', () => {
  const codes = (rules: Parameters<typeof doc>[0], extra = {}) =>
    detectConflicts(compiled(policySet({ p: doc(rules, extra) }))).map((f) => f.code);

  it('flags an ALLOW fully shadowed by an unconditional DENY', () => {
    const findings = detectConflicts(compiled(policySet({
      p: doc([rule({ id: 'allow', effect: 'ALLOW' }), rule({ id: 'deny', effect: 'DENY', actions: ['crm.*'], resourceTypes: ['*'] })]),
    })));
    expect(findings).toContainEqual(expect.objectContaining({ code: 'SHADOWED_ALLOW', severity: 'warning', rules: ['p/allow', 'p/deny'] }));
  });

  it('detects shadowing across policies', () => {
    const findings = detectConflicts(compiled(policySet({
      a: doc([rule({ id: 'allow', effect: 'ALLOW' })]),
      b: doc([rule({ id: 'deny-all', effect: 'DENY', actions: ['*'], resourceTypes: ['*'] })]),
    })));
    expect(findings.map((f) => f.code)).toContain('SHADOWED_ALLOW');
  });

  it('does not flag a narrower DENY as shadowing a broader ALLOW', () => {
    const c = codes([
      rule({ id: 'allow', effect: 'ALLOW', actions: ['crm.*'] }),
      rule({ id: 'deny', effect: 'DENY', actions: ['crm.customers.delete'] }),
    ]);
    expect(c).not.toContain('SHADOWED_ALLOW');
  });

  it('flags ALLOWs that always need approval and overlaps with conditional DENYs', () => {
    expect(codes([rule({ id: 'allow', effect: 'ALLOW' }), rule({ id: 'gate', effect: 'REQUIRE_APPROVAL' })])).toContain('ALLOW_ALWAYS_NEEDS_APPROVAL');
    expect(codes([
      rule({ id: 'allow', effect: 'ALLOW' }),
      rule({ id: 'deny', effect: 'DENY', when: { exists: 'env.incident' } }),
    ])).toContain('OVERLAPPING_ALLOW_DENY');
  });

  it('warns when rules depend on untrusted caller context', () => {
    expect(codes([rule({ id: 'a', effect: 'ALLOW', when: { eq: [{ ref: 'request.context.approved' }, { value: true }] } })])).toContain(
      'UNTRUSTED_CONTEXT_IN_ALLOW',
    );
    expect(codes([rule({ id: 'd', effect: 'DENY', when: { not: { eq: [{ ref: 'request.context.safe' }, { value: true }] } } })])).toContain(
      'UNTRUSTED_CONTEXT_IN_RESTRICTION',
    );
  });

  it('warns about unrestricted ALLOW, constant conditions, duplicates; errors on dead catalog actions', () => {
    expect(codes([rule({ id: 'a', effect: 'ALLOW', actions: ['*'], resourceTypes: ['*'] })])).toContain('UNRESTRICTED_ALLOW');
    expect(codes([rule({ id: 'a', effect: 'ALLOW', when: { eq: [{ value: 1 }, { value: 1 }] } })])).toContain('CONSTANT_CONDITION');
    expect(codes([rule({ id: 'a', effect: 'ALLOW' }), rule({ id: 'b', effect: 'ALLOW' })])).toContain('DUPLICATE_RULE');
    const findings = detectConflicts(compiled(policySet({
      p: doc([rule({ id: 'a', effect: 'ALLOW', actions: ['crm.customers.exprot'] })], { actionCatalog: ['crm.customers.export'] }),
    })));
    expect(findings).toContainEqual(expect.objectContaining({ code: 'ACTION_NOT_IN_CATALOG', severity: 'error' }));
  });

  it('reports nothing alarming for the reference export policy', () => {
    const severe = detectConflicts(exportSet()).filter((f) => f.severity !== 'info');
    expect(severe).toEqual([]);
  });

  it('is deterministic', () => {
    expect(detectConflicts(exportSet())).toEqual(detectConflicts(exportSet()));
  });
});

describe('simulate (dry run)', () => {
  const cases = [
    { name: 'small internal', input: input(), expectEffect: 'ALLOW' as const },
    { name: 'bulk external', input: input({}, { recordCount: 15000, destination: 'external' }), expectEffect: 'REQUIRE_APPROVAL' as const },
    { name: 'restricted', input: input({}, { sensitivity: 'restricted' }), expectEffect: 'DENY' as const },
  ];

  it('evaluates the current policy without a candidate', () => {
    const report = simulate(exportSet(), null, cases);
    expect(report.ok).toBe(true);
    expect(report.summary).toMatchObject({ total: 3, changed: 0, widened: 0, failedExpectations: 0 });
  });

  it('reports changed and widened decisions for a candidate that drops the approval gate', () => {
    const loosened = doc(
      exportPolicy.rules
        .filter((r) => r.id !== 'approve-bulk-or-external')
        .concat([rule({ id: 'allow-all-exports', effect: 'ALLOW' })]),
      { actionCatalog: exportPolicy.actionCatalog! },
    );
    const report = simulate(exportSet(), policySet({ 'data-export': loosened }, TENANT, 2), cases);
    expect(report.summary.widened).toBe(1);
    expect(report.summary.transitions).toEqual({ 'REQUIRE_APPROVAL->ALLOW': 1 });
    expect(report.ok).toBe(false); // the bulk-export expectation now fails
    expect(report.results.find((r) => r.name === 'bulk external')).toMatchObject({ changed: true, widened: true, expectationMet: false });
  });

  it('reports candidate validation issues without throwing', () => {
    const report = simulate(exportSet(), { tenantId: TENANT, revision: 2, policies: 'nope' }, cases);
    expect(report.ok).toBe(false);
    expect(report.candidateIssues.length).toBeGreaterThan(0);
    expect(report.results.every((r) => r.candidate?.effect === 'DENY')).toBe(true);
  });
});

describe('backend seam adapter', () => {
  const ctx = (i = input()): LoadedContext => ({
    agent: i.agent,
    principal: i.principal,
    grants: i.grants,
    environment: i.environment,
    approval: i.approval,
  });
  const engine = createBackendPolicyEngine({
    loadContext: async () => ctx(),
    clock: () => new Date('2026-11-02T10:30:00.000Z'),
    approverRole: 'security-approver',
  });
  const args = (request: unknown, document: unknown = exportPolicy) => ({
    tenantId: TENANT,
    principal: { tenantId: TENANT, id: 'usr_alice' },
    request,
    policy: { version: 'v7', document },
    signal: new AbortController().signal,
  });

  it('validates policies with the engine compiler', async () => {
    expect(await engine.validatePolicy(exportPolicy)).toBe(true);
    expect(await engine.validatePolicy({ rules: 'allow all' })).toBe(false);
  });

  it('maps decisions into the backend result shape', async () => {
    expect(await engine.evaluate(args(input().request))).toEqual({ effect: 'ALLOW', reasonCodes: ['POLICY_ALLOW'], trace: ['tenant-policy:allow-small-internal-export'], ttlSeconds: 60 });
    const bulk = input({}, { recordCount: 15000, destination: 'external' }).request;
    expect(await engine.evaluate(args(bulk))).toEqual({
      effect: 'REQUIRE_APPROVAL',
      reasonCodes: ['APPROVAL_REQUIRED'],
      trace: ['tenant-policy:approve-bulk-or-external'],
      ttlSeconds: 300,
      approval: { requiredRole: 'security-approver', prohibitSelf: true },
    });
  });

  it('returns the same decision as calling the engine directly', async () => {
    const direct = evaluate(compiled(policySet({ 'tenant-policy': exportPolicy }, TENANT, 0)), input());
    const viaAdapter = await engine.evaluate(args(input().request));
    expect(viaAdapter.effect).toBe(direct.effect);
    expect(viaAdapter.reasonCodes).toEqual(direct.reasonCodes);
  });

  it('fails closed on requests that diverge from the frozen contract (nested context)', async () => {
    const req = { ...input().request, context: { arguments: { table: 'customers' } } };
    expect(await engine.evaluate(args(req))).toMatchObject({ effect: 'DENY', reasonCodes: ['INVALID_INPUT'] });
  });

  it('DENYs without a policy, and rejects a policy set for another tenant', async () => {
    expect(await engine.evaluate({ ...args(input().request), policy: null })).toMatchObject({ effect: 'DENY', reasonCodes: ['NO_ACTIVE_POLICY'] });
    const foreign = policySet({ p: exportPolicy }, 'tnt_other');
    expect(await engine.evaluate(args(input().request, foreign))).toMatchObject({ effect: 'DENY', reasonCodes: ['POLICY_TENANT_MISMATCH'] });
  });

  it('honours cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(engine.evaluate({ ...args(input().request), signal: controller.signal })).rejects.toThrow();
  });

  it('propagates context-loader failures (the backend maps them to 503, never ALLOW)', async () => {
    const failing = createBackendPolicyEngine({ loadContext: async () => { throw new Error('db down'); } });
    await expect(failing.evaluate(args(input().request))).rejects.toThrow('db down');
  });

  it('supports approvals resolved through the backend context', async () => {
    const bulk = input({}, { recordCount: 15000, destination: 'external' });
    const set = compiled(policySet({ 'tenant-policy': exportPolicy }, TENANT, 0));
    const resumed = withApproval(bulk, { policyVersion: set.policyVersion });
    const e = createBackendPolicyEngine({ loadContext: async () => ctx(resumed), clock: () => new Date('2026-11-02T10:30:00Z') });
    expect(await e.evaluate(args(resumed.request))).toMatchObject({ effect: 'ALLOW', reasonCodes: ['APPROVAL_SATISFIED'] });
  });
});

describe('backend integration fixtures', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../fixtures/engine-cases.json', import.meta.url), 'utf8')) as {
    policySet: unknown;
    cases: Array<{ name: string; input: unknown; expect: { effect: string; reasonCodes: string[] } }>;
  };
  it('has cases', () => expect(fixtures.cases.length).toBeGreaterThanOrEqual(10));
  for (const c of fixtures.cases) {
    it(c.name, () => {
      const d = evaluate(fixtures.policySet, c.input);
      expect({ effect: d.effect, reasonCodes: d.reasonCodes }).toEqual(c.expect);
    });
  }
});
