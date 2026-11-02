import { LIMITS, SENSITIVITY_ORDER, validate, type Condition, type Operand, type PolicyRule } from '@aegis/contracts';
import { sha256Digest } from '@aegis/contracts/crypto';
import { hhmmToMinutes } from './match.js';
import {
  PolicySet,
  type CompiledPolicySet,
  type CompiledRule,
  type CompileResult,
  type PolicyIssue,
} from './types.js';

/** Upper bound on the worst-case evaluation cost of a policy set; larger sets are rejected at write time. */
export const MAX_STATIC_COST = 50_000;

/** Only objects produced by compilePolicySet are trusted as compiled; anything else is re-validated. */
const COMPILED = new WeakSet<object>();

export function isCompiled(value: unknown): value is CompiledPolicySet {
  return typeof value === 'object' && value !== null && COMPILED.has(value);
}

/**
 * Validates a tenant policy set (schema + semantics) and produces an immutable compiled form.
 * Pure: no I/O, no clock. Never throws for any input; returns issues instead.
 */
export function compilePolicySet(input: unknown): CompileResult {
  try {
    return compileUnsafe(input);
  } catch (err) {
    return { ok: false, issues: [{ path: '', code: 'COMPILER_ERROR', message: (err as Error).message }] };
  }
}

function compileUnsafe(input: unknown): CompileResult {
  // Snapshot first, then validate the snapshot: getters/proxies cannot change values after validation,
  // and freezing the compiled rules never freezes the caller's objects.
  let snapshot: unknown;
  try {
    snapshot = structuredClone(input);
  } catch {
    return { ok: false, issues: [{ path: '', code: 'SCHEMA', message: 'policy set is not plain JSON data' }] };
  }
  const checked = validate(PolicySet, snapshot);
  if (!checked.ok) {
    return { ok: false, issues: checked.issues.map((i) => ({ path: i.path, code: 'SCHEMA', message: i.message })) };
  }
  const set = checked.value as PolicySet;
  const issues: PolicyIssue[] = [];
  const seenPolicies = new Set<string>();
  const rules: CompiledRule[] = [];
  let catalog: Set<string> | null = null;
  let ttl: number = LIMITS.decisionTtlSecondsDefault;
  let ttlSet = false;
  let cost = 0;

  const ordered = set.policies
    .map((p, index) => ({ p, index }))
    .sort((a, b) => (a.p.policyId < b.p.policyId ? -1 : a.p.policyId > b.p.policyId ? 1 : 0));

  for (const { p, index } of ordered) {
    const base = `/policies/${index}`;
    if (seenPolicies.has(p.policyId)) {
      issues.push({ path: `${base}/policyId`, code: 'DUPLICATE_POLICY', message: `duplicate policyId ${p.policyId}` });
      continue;
    }
    seenPolicies.add(p.policyId);
    const doc = p.document;
    if (doc.actionCatalog) {
      catalog ??= new Set();
      for (const a of doc.actionCatalog) catalog.add(a);
    }
    if (doc.decisionTtlSeconds !== undefined) {
      ttl = ttlSet ? Math.min(ttl, doc.decisionTtlSeconds) : doc.decisionTtlSeconds;
      ttlSet = true;
    }
    const ruleIds = new Set<string>();
    doc.rules.forEach((rule, r) => {
      const path = `${base}/document/rules/${r}`;
      if (ruleIds.has(rule.id)) {
        issues.push({ path: `${path}/id`, code: 'DUPLICATE_RULE_ID', message: `duplicate rule id ${rule.id}` });
      }
      ruleIds.add(rule.id);
      cost += checkRule(rule as PolicyRule, path, issues);
      rules.push(Object.freeze({ key: `${p.policyId}/${rule.id}`, policyId: p.policyId, rule: deepFreeze(rule as PolicyRule) }));
    });
  }

  if (cost > MAX_STATIC_COST) {
    issues.push({ path: '/policies', code: 'POLICY_TOO_COMPLEX', message: `worst-case cost ${cost} exceeds ${MAX_STATIC_COST}` });
  }
  if (issues.length > 0) return { ok: false, issues };

  const digest = sha256Digest({
    kind: 'aegis.policy-set/v1',
    tenantId: set.tenantId,
    revision: set.revision,
    policies: ordered.map(({ p }) => ({ policyId: p.policyId, version: p.version, document: p.document })),
  });
  const compiled: CompiledPolicySet = Object.freeze({
    ok: true as const,
    tenantId: set.tenantId,
    revision: set.revision,
    policyVersion: `r${set.revision}.${digest.slice('sha256:'.length, 'sha256:'.length + 12)}`,
    rules: Object.freeze(rules),
    actionCatalog: catalog ? Object.freeze(catalog) : null,
    decisionTtlSeconds: Math.min(ttl, LIMITS.decisionTtlSecondsMax),
    policyCount: ordered.length,
    staticCost: cost,
  });
  COMPILED.add(compiled);
  return compiled;
}

/** Validates one rule and returns its worst-case evaluation cost (mirrors the runtime budget charges). */
function checkRule(rule: PolicyRule, path: string, issues: PolicyIssue[]): number {
  let cost = 1 + rule.actions.length + rule.resourceTypes.length;
  if (rule.approval && rule.effect !== 'REQUIRE_APPROVAL') {
    issues.push({ path: `${path}/approval`, code: 'APPROVAL_ON_NON_APPROVAL_RULE', message: 'approval is only valid on REQUIRE_APPROVAL rules' });
  }
  if (rule.sensitivity?.min && rule.sensitivity.max && SENSITIVITY_ORDER[rule.sensitivity.min] > SENSITIVITY_ORDER[rule.sensitivity.max]) {
    issues.push({ path: `${path}/sensitivity`, code: 'EMPTY_SENSITIVITY_RANGE', message: 'sensitivity.min is above sensitivity.max' });
  }
  rule.timeWindows?.forEach((w, i) => {
    if (hhmmToMinutes(w.start) >= hhmmToMinutes(w.end)) {
      issues.push({ path: `${path}/timeWindows/${i}`, code: 'EMPTY_TIME_WINDOW', message: 'start must be before end (split overnight windows in two)' });
    }
  });
  if (rule.when) {
    const stats = { nodes: 0, listCost: 0 };
    checkCondition(rule.when, `${path}/when`, 1, stats, issues);
    if (stats.nodes > LIMITS.policyConditionNodesMax) {
      issues.push({ path: `${path}/when`, code: 'CONDITION_TOO_LARGE', message: `more than ${LIMITS.policyConditionNodesMax} nodes` });
    }
    cost += stats.nodes + stats.listCost;
  }
  return cost;
}

function checkCondition(
  c: Condition,
  path: string,
  depth: number,
  stats: { nodes: number; listCost: number },
  issues: PolicyIssue[],
): void {
  stats.nodes++;
  if (depth > LIMITS.policyConditionDepthMax) {
    issues.push({ path, code: 'CONDITION_TOO_DEEP', message: `nesting deeper than ${LIMITS.policyConditionDepthMax}` });
    return;
  }
  if ('all' in c) return c.all.forEach((x, i) => checkCondition(x, `${path}/all/${i}`, depth + 1, stats, issues));
  if ('any' in c) return c.any.forEach((x, i) => checkCondition(x, `${path}/any/${i}`, depth + 1, stats, issues));
  if ('not' in c) return checkCondition(c.not, `${path}/not`, depth + 1, stats, issues);
  if ('exists' in c || 'startsWith' in c || 'endsWith' in c) return;
  const [op, pair] = Object.entries(c)[0] as [string, [Operand, Operand]];
  const [left, right] = pair;
  if (op === 'in') {
    stats.listCost += 'values' in right ? right.values.length : LIMITS.attributeArrayMaxItems;
    if ('values' in left) issues.push({ path: `${path}/in/0`, code: 'INVALID_OPERAND', message: 'left operand of "in" must be a ref or value' });
    if ('value' in right) issues.push({ path: `${path}/in/1`, code: 'INVALID_OPERAND', message: 'right operand of "in" must be a list or a ref' });
    return;
  }
  if ('values' in left || 'values' in right) {
    issues.push({ path: `${path}/${op}`, code: 'INVALID_OPERAND', message: `"values" lists are only valid as the right operand of "in"` });
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
