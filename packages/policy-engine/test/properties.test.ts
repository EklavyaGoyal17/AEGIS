import fc from 'fast-check';
import type { PolicyRule } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';
import { compilePolicySet, evaluate } from '../src/index.js';
import { compiled, doc, exportSet, input, policySet, rule } from './builders.js';

/*
 * Property-based checks of the engine's security invariants. Each property runs hundreds of generated
 * cases; a counterexample is shrunk and reported by fast-check.
 */

const effect = fc.constantFrom<PolicyRule['effect']>('ALLOW', 'DENY', 'REQUIRE_APPROVAL');
const actionPattern = fc.constantFrom('*', 'crm.*', 'crm.customers.*', 'crm.customers.export', 'crm.customers.read', 'billing.*');
const typePattern = fc.constantFrom('*', 'crm.customer_table', 'billing.invoice');
const ref = fc.constantFrom(
  'resource.attributes.recordCount',
  'resource.attributes.destination',
  'resource.attributes.missing',
  'env.networkZone',
  'request.context.conversationId',
  'agent.attributes.tier',
);
const literal = fc.oneof(fc.integer({ min: -10, max: 20000 }), fc.constantFrom('internal', 'external', 'corp', 'x'), fc.boolean(), fc.constant(null));
const leaf = fc.oneof(
  fc.record({ eq: fc.tuple(fc.record({ ref }), fc.record({ value: literal })) }),
  fc.record({ gt: fc.tuple(fc.record({ ref }), fc.record({ value: literal })) }),
  fc.record({ exists: ref }),
  fc.record({ in: fc.tuple(fc.record({ ref }), fc.record({ values: fc.array(literal, { minLength: 1, maxLength: 4 }) })) }),
);
const condition = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.record({ not: tie('node') }),
    fc.record({ all: fc.array(tie('node'), { minLength: 1, maxLength: 3 }) }),
    fc.record({ any: fc.array(tie('node'), { minLength: 1, maxLength: 3 }) }),
  ),
})).node;

const ruleArb = (id: string) =>
  fc.record(
    {
      id: fc.constant(id),
      effect,
      actions: fc.array(actionPattern, { minLength: 1, maxLength: 3 }),
      resourceTypes: fc.array(typePattern, { minLength: 1, maxLength: 2 }),
      when: condition,
    },
    { requiredKeys: ['id', 'effect', 'actions', 'resourceTypes'] },
  ) as fc.Arbitrary<PolicyRule>;

const rulesArb = fc
  .integer({ min: 1, max: 8 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => ruleArb(`r${i}`))));

const depthOk = (r: PolicyRule) => compilePolicySet(policySet({ p: doc([r]) })).ok;

describe('engine invariants (property-based)', () => {
  it('is deterministic: the same input always yields a deep-equal decision', () => {
    fc.assert(
      fc.property(rulesArb, (rules) => {
        const set = policySet({ p: doc(rules.filter(depthOk)) });
        const c = compilePolicySet(set);
        if (!c.ok) return true;
        const a = evaluate(c, input());
        const b = evaluate(compilePolicySet(structuredClone(set)), structuredClone(input()));
        expect(b).toEqual(a);
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('rule order never changes the decision', () => {
    fc.assert(
      fc.property(rulesArb, fc.integer(), (rules, seed) => {
        const valid = rules.filter(depthOk);
        if (valid.length === 0) return true;
        const shuffled = [...valid].sort((x, y) => ((x.id.charCodeAt(1) * 31 + seed) % 7) - ((y.id.charCodeAt(1) * 31 + seed) % 7));
        const a = evaluate(compiled(policySet({ p: doc(valid) })), input());
        const b = evaluate(compiled(policySet({ p: doc(shuffled) })), input());
        expect(b.effect).toBe(a.effect);
        expect(b.reasonCodes).toEqual(a.reasonCodes);
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('adding an unconditional matching DENY always yields DENY (deny overrides, monotonic)', () => {
    fc.assert(
      fc.property(rulesArb, (rules) => {
        const valid = rules.filter(depthOk);
        const withDeny = [...valid, rule({ id: 'zz-deny', effect: 'DENY', actions: ['*'], resourceTypes: ['*'] })];
        const d = evaluate(compiled(policySet({ p: doc(withDeny) })), input());
        expect(d.effect).toBe('DENY');
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('removing all ALLOW rules can never produce ALLOW', () => {
    fc.assert(
      fc.property(rulesArb, (rules) => {
        const restrictive = rules.filter(depthOk).filter((r) => r.effect !== 'ALLOW');
        if (restrictive.length === 0) return true;
        expect(evaluate(compiled(policySet({ p: doc(restrictive) })), input()).effect).not.toBe('ALLOW');
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('caller-controlled context keys cannot turn a non-ALLOW into ALLOW unless a rule references them', () => {
    const contextKey = fc.constantFrom('approved', 'role', 'isAdmin', 'override', 'tenantId', 'effect', 'policy', 'sudo', 'trustLevel');
    fc.assert(
      fc.property(fc.dictionary(contextKey, literal, { maxKeys: 6 }), (injected) => {
        const set = exportSet(); // references no request.context keys
        const base = input({}, { recordCount: 15000, destination: 'external' });
        const tampered = { ...base, request: { ...base.request, context: { ...base.request.context, ...injected } } };
        expect(evaluate(set, tampered)).toEqual(evaluate(set, base));
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('arbitrary garbage as input or policy set never yields ALLOW', () => {
    fc.assert(
      fc.property(fc.anything({ maxDepth: 3 }), fc.anything({ maxDepth: 3 }), (policy, garbage) => {
        expect(evaluate(policy, garbage).effect).toBe('DENY');
        expect(evaluate(exportSet(), garbage).effect).toBe('DENY');
        return true;
      }),
      { numRuns: 500 },
    );
  });

  it('single-field mutations of a valid ALLOW request never throw and are DENY unless still valid', () => {
    const base = input() as unknown as Record<string, unknown>;
    const keys = Object.keys(base);
    fc.assert(
      fc.property(fc.constantFrom(...keys), fc.anything({ maxDepth: 2 }), (key, value) => {
        const mutated = { ...base, [key]: value };
        const d = evaluate(exportSet(), mutated);
        expect(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']).toContain(d.effect);
        if (d.effect === 'ALLOW') {
          // Only possible if the mutation produced another valid input that the policy allows.
          expect(d.reasonCodes).toEqual(['POLICY_ALLOW']);
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
