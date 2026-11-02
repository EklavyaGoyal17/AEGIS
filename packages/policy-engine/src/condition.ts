import type { AttributeValue, Condition, Operand } from '@aegis/contracts';

/** Kleene three-valued logic. */
export type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';

export class BudgetExceeded extends Error {
  override readonly name = 'BudgetExceeded';
}

export class Budget {
  private used = 0;
  constructor(private readonly max: number) {}
  spend(units = 1): void {
    this.used += units;
    if (this.used > this.max) throw new BudgetExceeded();
  }
  get steps(): number {
    return this.used;
  }
}

/** Read-only view over the attribute roots a condition may reference. */
export interface AttributeScope {
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly resourceAttributes: Readonly<Record<string, AttributeValue>>;
  readonly agentId: string;
  readonly agentAttributes: Readonly<Record<string, AttributeValue>>;
  readonly principalId: string;
  readonly principalAttributes: Readonly<Record<string, AttributeValue>>;
  readonly requestContext: Readonly<Record<string, AttributeValue>>;
  readonly environment: Readonly<Record<string, AttributeValue>>;
}

const MISSING: unique symbol = Symbol('missing');
type Resolved = AttributeValue | typeof MISSING;

const PREFIXED: ReadonlyArray<[string, keyof AttributeScope]> = [
  ['resource.attributes.', 'resourceAttributes'],
  ['agent.attributes.', 'agentAttributes'],
  ['principal.attributes.', 'principalAttributes'],
  ['request.context.', 'requestContext'],
  ['env.', 'environment'],
];

export function resolveRef(ref: string, scope: AttributeScope): Resolved {
  switch (ref) {
    case 'action':
      return scope.action;
    case 'resource.type':
      return scope.resourceType;
    case 'resource.id':
      return scope.resourceId;
    case 'agent.id':
      return scope.agentId;
    case 'principal.id':
      return scope.principalId;
  }
  for (const [prefix, field] of PREFIXED) {
    if (ref.startsWith(prefix)) {
      const map = scope[field] as Readonly<Record<string, AttributeValue>>;
      const key = ref.slice(prefix.length);
      // Own properties only: inherited members (toString, constructor, __proto__) are never attributes.
      return Object.hasOwn(map, key) ? (map[key] as AttributeValue) : MISSING;
    }
  }
  return MISSING;
}

function operand(op: Operand, scope: AttributeScope): Resolved {
  if ('ref' in op) return resolveRef(op.ref, scope);
  if ('value' in op) return op.value;
  return op.values;
}

type Scalar = string | number | boolean | null;

function isScalar(v: Resolved): v is Scalar {
  return v !== MISSING && !Array.isArray(v);
}

function kind(v: Scalar): string {
  return v === null ? 'null' : typeof v;
}

function equal(a: Resolved, b: Resolved): Tri {
  if (!isScalar(a) || !isScalar(b) || kind(a) !== kind(b)) return 'UNKNOWN';
  return a === b ? 'TRUE' : 'FALSE';
}

function order(a: Resolved, b: Resolved, test: (c: number) => boolean): Tri {
  if (!isScalar(a) || !isScalar(b)) return 'UNKNOWN';
  if (typeof a === 'number' && typeof b === 'number') return test(a < b ? -1 : a > b ? 1 : 0) ? 'TRUE' : 'FALSE';
  if (typeof a === 'string' && typeof b === 'string') return test(a < b ? -1 : a > b ? 1 : 0) ? 'TRUE' : 'FALSE';
  return 'UNKNOWN';
}

function not(t: Tri): Tri {
  return t === 'TRUE' ? 'FALSE' : t === 'FALSE' ? 'TRUE' : 'UNKNOWN';
}

/**
 * Evaluates a validated condition. No coercion, no regular expressions, no dynamic code. Every node
 * costs one budget unit, list scans cost one unit per element.
 */
export function evaluateCondition(cond: Condition, scope: AttributeScope, budget: Budget): Tri {
  budget.spend();
  if ('all' in cond) {
    let unknown = false;
    for (const c of cond.all) {
      const r = evaluateCondition(c, scope, budget);
      if (r === 'FALSE') return 'FALSE';
      if (r === 'UNKNOWN') unknown = true;
    }
    return unknown ? 'UNKNOWN' : 'TRUE';
  }
  if ('any' in cond) {
    let unknown = false;
    for (const c of cond.any) {
      const r = evaluateCondition(c, scope, budget);
      if (r === 'TRUE') return 'TRUE';
      if (r === 'UNKNOWN') unknown = true;
    }
    return unknown ? 'UNKNOWN' : 'FALSE';
  }
  if ('not' in cond) return not(evaluateCondition(cond.not, scope, budget));
  if ('exists' in cond) return resolveRef(cond.exists, scope) === MISSING ? 'FALSE' : 'TRUE';
  if ('eq' in cond) return equal(operand(cond.eq[0], scope), operand(cond.eq[1], scope));
  if ('ne' in cond) return not(equal(operand(cond.ne[0], scope), operand(cond.ne[1], scope)));
  if ('lt' in cond) return order(operand(cond.lt[0], scope), operand(cond.lt[1], scope), (c) => c < 0);
  if ('lte' in cond) return order(operand(cond.lte[0], scope), operand(cond.lte[1], scope), (c) => c <= 0);
  if ('gt' in cond) return order(operand(cond.gt[0], scope), operand(cond.gt[1], scope), (c) => c > 0);
  if ('gte' in cond) return order(operand(cond.gte[0], scope), operand(cond.gte[1], scope), (c) => c >= 0);
  if ('in' in cond) {
    const needle = operand(cond.in[0], scope);
    const haystack = operand(cond.in[1], scope);
    if (!isScalar(needle) || !Array.isArray(haystack)) return 'UNKNOWN';
    budget.spend(haystack.length);
    return haystack.some((v) => kind(v) === kind(needle) && v === needle) ? 'TRUE' : 'FALSE';
  }
  if ('startsWith' in cond) {
    const v = resolveRef(cond.startsWith[0].ref, scope);
    return typeof v === 'string' ? (v.startsWith(cond.startsWith[1]) ? 'TRUE' : 'FALSE') : 'UNKNOWN';
  }
  if ('endsWith' in cond) {
    const v = resolveRef(cond.endsWith[0].ref, scope);
    return typeof v === 'string' ? (v.endsWith(cond.endsWith[1]) ? 'TRUE' : 'FALSE') : 'UNKNOWN';
  }
  // Unreachable for validated input; an unknown node must never contribute a TRUE.
  return 'UNKNOWN';
}

/** Collects every attribute reference in a condition (used by the conflict detector). */
export function collectRefs(cond: Condition, out: string[] = []): string[] {
  if ('all' in cond) cond.all.forEach((c) => collectRefs(c, out));
  else if ('any' in cond) cond.any.forEach((c) => collectRefs(c, out));
  else if ('not' in cond) collectRefs(cond.not, out);
  else if ('exists' in cond) out.push(cond.exists);
  else if ('startsWith' in cond) out.push(cond.startsWith[0].ref);
  else if ('endsWith' in cond) out.push(cond.endsWith[0].ref);
  else {
    const pair = Object.values(cond)[0] as [Operand, Operand];
    for (const op of pair) if ('ref' in op) out.push(op.ref);
  }
  return out;
}
