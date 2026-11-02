import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, CanonicalizationError } from '../src/index.js';
import { computeArgumentsDigest, sha256Digest } from '../src/crypto/index.js';

describe('canonicalJson', () => {
  it.each<[unknown, string]>([
    [null, 'null'],
    [true, 'true'],
    [0, '0'],
    [-0, '0'],
    [1e21, '1e+21'],
    [0.1, '0.1'],
    ['é "', '"é \\""'],
    [[1, 'a', null], '[1,"a",null]'],
    [{ b: 1, a: { d: [], c: {} } }, '{"a":{"c":{},"d":[]},"b":1}'],
    // UTF-16 code-unit ordering (RFC 8785 §3.2.3): "é" < "😀" < "Ａ"
    [{ 'Ａ': 1, '😀': 2, 'é': 3 }, '{"é":3,"😀":2,"Ａ":1}'],
  ])('vector %#', (input, expected) => {
    expect(canonicalJson(input)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['undefined', undefined],
    ['undefined property', { a: undefined }],
    ['function', () => 1],
    ['bigint', 1n],
    ['symbol', Symbol('x')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['sparse array', [1, , 3]],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalizationError);
  });

  it('rejects cycles and excessive depth', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => canonicalJson(a)).toThrow(CanonicalizationError);
    let deep: unknown = 1;
    for (let i = 0; i < 40; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow(CanonicalizationError);
  });

  it('allows shared (non-cyclic) references', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('is independent of key insertion order and round-trips through JSON.parse', () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
        const c = canonicalJson(value);
        const reordered = JSON.parse(JSON.stringify(value), (_k, v) =>
          v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
        );
        return canonicalJson(JSON.parse(c)) === c && canonicalJson(reordered) === c;
      }),
      { numRuns: 500 },
    );
  });
});

describe('digests', () => {
  it('sha256Digest has the documented format', () => {
    expect(sha256Digest({})).toBe('sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('arguments digest is domain-separated from a plain digest', () => {
    expect(computeArgumentsDigest({ a: 1 })).not.toBe(sha256Digest({ a: 1 }));
  });

  it('arguments digest changes when any argument changes', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 4 }), fc.integer()), fc.string({ maxLength: 4 }), (args, k) => {
        const changed = { ...args, [k]: (args[k] ?? 0) + 1 };
        return computeArgumentsDigest(args) !== computeArgumentsDigest(changed);
      }),
    );
  });
});
