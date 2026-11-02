import { LIMITS } from './limits.js';

/**
 * AEGIS canonical JSON (a strict subset of RFC 8785 / JCS):
 *  - object keys sorted by UTF-16 code unit order, no insignificant whitespace;
 *  - numbers serialized with ECMAScript Number.prototype.toString (identical to JCS for finite numbers);
 *  - only plain objects, arrays, strings, finite numbers, booleans and null are accepted;
 *  - `undefined`, functions, symbols, bigint, NaN/Infinity, class instances, and cycles throw;
 *  - nesting depth is bounded.
 * Digests over this encoding bind approvals, execution authorizations and audit events, so any
 * implementation in another language MUST produce byte-identical output (see test vectors).
 */
export class CanonicalizationError extends Error {
  override readonly name = 'CanonicalizationError';
}

export function canonicalJson(value: unknown): string {
  return encode(value, 0, new Set());
}

function encode(value: unknown, depth: number, seen: Set<object>): string {
  if (depth > LIMITS.canonicalJsonMaxDepth) throw new CanonicalizationError('maximum nesting depth exceeded');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError('non-finite number');
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new CanonicalizationError(`unsupported type: ${typeof value}`);
  }
  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizationError('cyclic structure');
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) throw new CanonicalizationError('sparse array');
        parts.push(encode(obj[i], depth + 1, seen));
      }
      return `[${parts.join(',')}]`;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) throw new CanonicalizationError('non-plain object');
    if (Object.getOwnPropertySymbols(obj).length > 0) throw new CanonicalizationError('symbol keys');
    const keys = Object.keys(obj).sort(compareUtf16);
    const parts: string[] = [];
    for (const key of keys) {
      const v = (obj as Record<string, unknown>)[key];
      if (v === undefined) throw new CanonicalizationError(`undefined value at key ${JSON.stringify(key)}`);
      parts.push(`${JSON.stringify(key)}:${encode(v, depth + 1, seen)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
