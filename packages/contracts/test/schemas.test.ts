import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EvaluateDecisionRequest,
  isRfc3339Utc,
  LIMITS,
  SCHEMAS,
  validate,
} from '../src/index.js';
import { createAjv, EXAMPLE_SCHEMAS, loadExamples, readJson } from './helpers.js';

const ajv = createAjv();
const examples = loadExamples();

interface ContractCase {
  name: string;
  schema: string;
  valid: boolean;
  payload: unknown;
}
const { cases } = readJson<{ cases: ContractCase[] }>('fixtures/contract-cases.json');

describe('examples', () => {
  it('every example (except raw tool arguments) is mapped to a schema', () => {
    const unmapped = Object.keys(examples).filter((n) => n !== 'tool-arguments' && !(n in EXAMPLE_SCHEMAS));
    expect(unmapped).toEqual([]);
  });

  for (const [name, schemaName] of Object.entries(EXAMPLE_SCHEMAS)) {
    it(`${name} is a valid ${schemaName} (TypeBox and Ajv agree)`, () => {
      const result = validate(SCHEMAS[schemaName]!, examples[name]);
      expect(result.ok ? [] : result.issues).toEqual([]);
      expect(ajv(schemaName)(examples[name])).toBe(true);
    });
  }
});

describe('contract conformance fixtures', () => {
  it('has a meaningful number of cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });
  for (const c of cases) {
    it(`${c.valid ? 'accepts' : 'rejects'}: ${c.name}`, () => {
      const schema = SCHEMAS[c.schema];
      expect(schema, `unknown schema ${c.schema}`).toBeDefined();
      expect(validate(schema!, c.payload).ok).toBe(c.valid);
      expect(ajv(c.schema)(c.payload)).toBe(c.valid);
    });
  }
});

describe('bounds', () => {
  const base = readJson<Record<string, unknown>>('examples/evaluate-request.json');
  const withContext = (context: unknown) => ({ ...base, context });

  it('rejects attribute strings longer than the limit', () => {
    const s = 'x'.repeat(LIMITS.attributeStringMaxLength + 1);
    expect(validate(EvaluateDecisionRequest, withContext({ s })).ok).toBe(false);
    expect(validate(EvaluateDecisionRequest, withContext({ s: s.slice(1) })).ok).toBe(true);
  });

  it('rejects attribute arrays longer than the limit and nested arrays', () => {
    expect(validate(EvaluateDecisionRequest, withContext({ a: Array(LIMITS.attributeArrayMaxItems + 1).fill(1) })).ok).toBe(false);
    expect(validate(EvaluateDecisionRequest, withContext({ a: [[1]] })).ok).toBe(false);
  });

  it('rejects more attributes than the limit', () => {
    const ctx: Record<string, number> = {};
    for (let i = 0; i <= LIMITS.attributesMaxProperties; i++) ctx[`k${i}`] = i;
    expect(validate(EvaluateDecisionRequest, withContext(ctx)).ok).toBe(false);
  });

  it('rejects non-finite numbers (which JSON cannot carry but in-process callers can)', () => {
    expect(validate(EvaluateDecisionRequest, withContext({ n: Number.NaN })).ok).toBe(false);
    expect(validate(EvaluateDecisionRequest, withContext({ n: Number.POSITIVE_INFINITY })).ok).toBe(false);
  });

  it('never throws, whatever the input', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const r = validate(EvaluateDecisionRequest, value);
        return typeof r.ok === 'boolean';
      }),
      { numRuns: 500 },
    );
  });
});

describe('differential: TypeBox runtime validation agrees with Ajv on the generated JSON Schema', () => {
  const scalar = fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.double({ noNaN: true, noDefaultInfinity: true }),
  );
  const key = fc.oneof(fc.constantFrom('a', 'recordCount', 'x_1', '__proto__', 'a.b', '1x', ''), fc.string({ maxLength: 4 }));
  const attrs = fc.dictionary(key, fc.oneof(scalar, fc.array(scalar, { maxLength: 3 }), fc.object({ maxDepth: 1 })), { maxKeys: 4 });
  const maybe = <T>(arb: fc.Arbitrary<T>) => fc.oneof(arb, fc.anything({ maxDepth: 1 }));
  const request = fc.record(
    {
      requestId: maybe(fc.uuid()),
      agentId: maybe(fc.constantFrom('agent-1', 'a', 'bad id', '')),
      action: maybe(fc.constantFrom('crm.customers.export', 'a.b', 'A.b', 'x', 'a.*')),
      resource: maybe(fc.record({ type: fc.constantFrom('crm.table', 'X'), id: fc.string({ maxLength: 5 }), attributes: attrs })),
      context: maybe(attrs),
      extra: fc.anything({ maxDepth: 1 }),
    },
    { requiredKeys: [] },
  );

  it('agrees on 1500 generated near-valid requests', () => {
    const check = ajv('EvaluateDecisionRequest');
    fc.assert(
      fc.property(request, (value) => validate(EvaluateDecisionRequest, value).ok === check(value)),
      { numRuns: 1500 },
    );
  });
});

describe('timestamps', () => {
  it.each([
    ['2026-11-02T18:30:00Z', true],
    ['2026-11-02T18:30:00.123456789Z', true],
    ['2024-02-29T00:00:00Z', true],
    ['2026-02-29T00:00:00Z', false],
    ['2026-13-01T00:00:00Z', false],
    ['2026-11-02T24:00:00Z', false],
    ['2026-11-02T18:30:60Z', false],
    ['2026-11-02T18:30:00+00:00', false],
    ['2026-11-02 18:30:00Z', false],
    ['2026-11-02T18:30:00z', false],
  ])('%s -> %s', (value, expected) => {
    expect(isRfc3339Utc(value)).toBe(expected);
  });
});
