import { validate, type DelegatedAuthority, type Effect, type KnownReasonCode, type PolicyRule } from '@aegis/contracts';
import { computeApprovalBindingDigest } from '@aegis/contracts/crypto';
import { compilePolicySet, isCompiled } from './compile.js';
import { Budget, BudgetExceeded, evaluateCondition, type AttributeScope } from './condition.js';
import {
  actionMatches,
  inTimeWindow,
  parseTimestamp,
  resourceTypeMatches,
  sensitivityInRange,
  sensitivityLevel,
} from './match.js';
import {
  EvaluationInput,
  type CompiledPolicySet,
  type EngineDecision,
  type EvaluateOptions,
  type MatchedRule,
  type PolicySet,
  type TraceStep,
} from './types.js';

/** Above MAX_STATIC_COST plus worst-case delegation work, so a set that compiles can always be evaluated. */
export const DEFAULT_MAX_STEPS = 60_000;
const DEFAULT_APPROVAL_TTL_SECONDS = 3600;
const UNKNOWN_POLICY_VERSION = 'unknown';

class Trace {
  readonly steps: TraceStep[] = [];
  add(step: string, outcome: TraceStep['outcome'], extra: { ref?: string; code?: string } = {}): void {
    this.steps.push({ step, outcome, ...extra });
  }
}

/**
 * Evaluates one authorization request. Deterministic and side-effect free: the result depends only on
 * the arguments. Never throws and never returns ALLOW on any error path.
 */
export function evaluate(
  policySet: CompiledPolicySet | PolicySet | unknown,
  input: unknown,
  options: EvaluateOptions = {},
): EngineDecision {
  const trace = new Trace();
  let policyVersion = UNKNOWN_POLICY_VERSION;
  try {
    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    const budget = new Budget(maxSteps);

    // 1. Input validation, on a snapshot so values cannot change between validation and use (TOCTOU).
    let snapshot: unknown;
    try {
      snapshot = structuredClone(input);
    } catch {
      trace.add('input', 'FAIL', { code: 'INVALID_INPUT' });
      return deny(['INVALID_INPUT'], policyVersion, trace);
    }
    const checked = validate(EvaluationInput, snapshot);
    if (!checked.ok) {
      trace.add('input', 'FAIL', { code: 'INVALID_INPUT' });
      return deny(['INVALID_INPUT'], policyVersion, trace);
    }
    const inp = checked.value as EvaluationInput;
    if (inp.resource.type !== inp.request.resource.type || inp.resource.id !== inp.request.resource.id) {
      trace.add('input.resource-consistency', 'FAIL', { code: 'INVALID_INPUT' });
      return deny(['INVALID_INPUT'], policyVersion, trace);
    }
    trace.add('input', 'PASS');

    // 2. Policy set validation
    const compiled = isCompiled(policySet) ? policySet : compilePolicySet(policySet);
    if (!compiled.ok) {
      trace.add('policy.compile', 'FAIL', { code: 'POLICY_INVALID' });
      return deny(['POLICY_INVALID'], policyVersion, trace);
    }
    policyVersion = compiled.policyVersion;
    trace.add('policy.compile', 'PASS', { ref: policyVersion });

    // 3-5. Tenant binding, version pin, non-empty
    if (compiled.tenantId !== inp.tenantId) {
      trace.add('policy.tenant', 'FAIL', { code: 'POLICY_TENANT_MISMATCH' });
      return deny(['POLICY_TENANT_MISMATCH'], policyVersion, trace);
    }
    if (inp.expectedPolicyVersion !== undefined && inp.expectedPolicyVersion !== policyVersion) {
      trace.add('policy.version', 'FAIL', { code: 'POLICY_VERSION_MISMATCH' });
      return deny(['POLICY_VERSION_MISMATCH'], policyVersion, trace);
    }
    if (compiled.rules.length === 0) {
      trace.add('policy.present', 'FAIL', { code: 'NO_ACTIVE_POLICY' });
      return deny(['NO_ACTIVE_POLICY'], policyVersion, trace);
    }

    // 6. Identity
    const identityFailure = checkIdentity(inp);
    if (identityFailure) {
      trace.add('identity', 'FAIL', { code: identityFailure });
      return deny([identityFailure], policyVersion, trace);
    }
    trace.add('identity', 'PASS');

    // 7. Action catalog
    const action = inp.request.action;
    if (compiled.actionCatalog && !compiled.actionCatalog.has(action)) {
      trace.add('action.catalog', 'FAIL', { code: 'ACTION_UNSUPPORTED' });
      return deny(['ACTION_UNSUPPORTED'], policyVersion, trace);
    }

    const nowMs = parseTimestamp(inp.now);
    const level = sensitivityLevel(inp.resource.attributes['sensitivity']);

    // 8. Delegated authority
    const delegation = checkDelegation(inp, nowMs, level, budget, trace);
    if (delegation !== null) return deny([delegation], policyVersion, trace);

    // 9. Rules
    const scope: AttributeScope = {
      action,
      resourceType: inp.resource.type,
      resourceId: inp.resource.id,
      resourceAttributes: inp.resource.attributes,
      agentId: inp.agent.agentId,
      agentAttributes: inp.agent.attributes,
      principalId: inp.principal.principalId,
      principalAttributes: inp.principal.attributes,
      requestContext: inp.request.context,
      environment: inp.environment,
    };
    const matched: MatchedRule[] = [];
    let approvalTtl: number | null = null;
    for (const { policyId, rule, key } of compiled.rules) {
      budget.spend();
      const outcome = ruleApplies(rule, action, inp.resource.type, level, nowMs, scope, budget);
      if (outcome === 'MATCH' || outcome === 'INDETERMINATE') {
        trace.add('rule', outcome, { ref: key });
        matched.push({ policyId, ruleId: rule.id, effect: rule.effect, indeterminate: outcome === 'INDETERMINATE' });
        if (rule.effect === 'REQUIRE_APPROVAL') {
          const t = rule.approval?.ttlSeconds ?? DEFAULT_APPROVAL_TTL_SECONDS;
          approvalTtl = approvalTtl === null ? t : Math.min(approvalTtl, t);
        }
      }
    }

    const denies = matched.filter((m) => m.effect === 'DENY');
    const approvals = matched.filter((m) => m.effect === 'REQUIRE_APPROVAL');
    const allows = matched.filter((m) => m.effect === 'ALLOW');
    const indeterminate = (ms: MatchedRule[]): KnownReasonCode[] =>
      ms.some((m) => m.indeterminate) ? ['CONDITION_INDETERMINATE'] : [];

    if (denies.length > 0) {
      trace.add('combine', 'RESULT', { code: 'EXPLICIT_DENY' });
      return result('DENY', ['EXPLICIT_DENY', ...indeterminate(denies)], policyVersion, denies, compiled.decisionTtlSeconds, trace);
    }
    if (approvals.length === 0) {
      if (allows.length > 0) {
        trace.add('combine', 'RESULT', { code: 'POLICY_ALLOW' });
        return result('ALLOW', ['POLICY_ALLOW'], policyVersion, allows, compiled.decisionTtlSeconds, trace);
      }
      trace.add('combine', 'RESULT', { code: 'DEFAULT_DENY' });
      return deny(['DEFAULT_DENY'], policyVersion, trace, compiled.decisionTtlSeconds);
    }

    // 10. Approval resolution
    const bindingDigest = computeApprovalBindingDigest({
      tenantId: inp.tenantId,
      agentId: inp.agent.agentId,
      principalId: inp.principal.principalId,
      action,
      resource: inp.resource,
      argumentsDigest: inp.request.argumentsDigest ?? null,
    });
    const ttl = approvalTtl ?? DEFAULT_APPROVAL_TTL_SECONDS;
    const pending = (codes: KnownReasonCode[]): EngineDecision => ({
      ...result('REQUIRE_APPROVAL', [...codes, ...indeterminate(approvals)], policyVersion, approvals, compiled.decisionTtlSeconds, trace),
      approval: { ttlSeconds: ttl, bindingDigest },
    });

    const approvalId = inp.request.approvalId;
    if (approvalId === undefined) {
      trace.add('approval', 'RESULT', { code: 'APPROVAL_REQUIRED' });
      return pending(['APPROVAL_REQUIRED']);
    }
    const apr = inp.approval;
    const fail = (code: KnownReasonCode): EngineDecision => {
      trace.add('approval', 'FAIL', { ref: approvalId, code });
      return deny([code], policyVersion, trace, compiled.decisionTtlSeconds, approvals);
    };
    if (apr === null || apr.approvalId !== approvalId) return fail('APPROVAL_NOT_FOUND');
    if (apr.tenantId !== inp.tenantId) return fail('APPROVAL_TENANT_MISMATCH');
    if (apr.bindingDigest !== bindingDigest) return fail('APPROVAL_BINDING_MISMATCH');
    if (apr.status === 'CONSUMED') return fail('APPROVAL_ALREADY_CONSUMED');
    if (apr.status === 'REJECTED' || apr.status === 'CANCELLED') return fail('APPROVAL_REJECTED');
    if (apr.status === 'PENDING') {
      trace.add('approval', 'RESULT', { ref: approvalId, code: 'APPROVAL_PENDING' });
      return pending(['APPROVAL_PENDING']);
    }
    const expiresMs = parseTimestamp(apr.expiresAt);
    if (apr.status === 'EXPIRED' || nowMs >= expiresMs) {
      trace.add('approval', 'RESULT', { ref: approvalId, code: 'APPROVAL_EXPIRED' });
      return pending(['APPROVAL_EXPIRED']);
    }
    // apr.status === 'APPROVED' from here on.
    const res = apr.resolution;
    if (res === null || res.decision !== 'APPROVE' || res.bindingDigest !== apr.bindingDigest) {
      return fail('APPROVAL_BINDING_MISMATCH');
    }
    if (
      res.resolvedBy === inp.principal.principalId ||
      res.resolvedBy === apr.requestingPrincipalId ||
      res.resolvedBy === inp.agent.agentId
    ) {
      return fail('APPROVAL_SELF_RESOLVED');
    }
    if (apr.policyVersion !== policyVersion) {
      trace.add('approval', 'RESULT', { ref: approvalId, code: 'APPROVAL_POLICY_VERSION_CHANGED' });
      return pending(['APPROVAL_POLICY_VERSION_CHANGED']);
    }
    trace.add('approval', 'PASS', { ref: approvalId, code: 'APPROVAL_SATISFIED' });
    // An approval-backed ALLOW never outlives the approval itself.
    const remaining = Math.max(1, Math.floor((expiresMs - nowMs) / 1000));
    return {
      ...result('ALLOW', ['APPROVAL_SATISFIED'], policyVersion, approvals, Math.min(compiled.decisionTtlSeconds, remaining), trace),
      consumesApprovalId: approvalId,
    };
  } catch (err) {
    const code: KnownReasonCode = err instanceof BudgetExceeded ? 'EVALUATION_BUDGET_EXCEEDED' : 'INTERNAL_ERROR';
    trace.add('engine', 'FAIL', { code });
    return deny([code], policyVersion, trace);
  }
}


function checkIdentity(inp: EvaluationInput): KnownReasonCode | null {
  if (inp.agent.agentId !== inp.request.agentId) return 'AGENT_IDENTITY_MISMATCH';
  if (inp.agent.tenantId !== inp.tenantId) return 'AGENT_TENANT_MISMATCH';
  if (inp.agent.status !== 'ACTIVE') return 'AGENT_INACTIVE';
  if (inp.principal.tenantId !== inp.tenantId) return 'PRINCIPAL_TENANT_MISMATCH';
  if (inp.principal.status !== 'ACTIVE') return 'PRINCIPAL_INACTIVE';
  return null;
}

const DELEGATION_SPECIFICITY: KnownReasonCode[] = [
  'DELEGATION_REVOKED',
  'DELEGATION_EXPIRED',
  'DELEGATION_NOT_YET_VALID',
  'DELEGATION_SENSITIVITY_EXCEEDED',
  'DELEGATION_SCOPE_EXCEEDED',
];

function checkDelegation(
  inp: EvaluationInput,
  nowMs: number,
  level: number,
  budget: Budget,
  trace: Trace,
): KnownReasonCode | null {
  const candidates = [...inp.grants]
    .filter(
      (g) =>
        g.tenantId === inp.tenantId &&
        g.agentId === inp.agent.agentId &&
        g.delegatorPrincipalId === inp.principal.principalId,
    )
    .sort((a, b) => (a.grantId < b.grantId ? -1 : a.grantId > b.grantId ? 1 : 0));
  if (candidates.length === 0) {
    trace.add('delegation', 'FAIL', { code: 'DELEGATION_MISSING' });
    return 'DELEGATION_MISSING';
  }
  const misses = new Set<KnownReasonCode>();
  for (const g of candidates) {
    budget.spend(1 + g.actions.length + g.scopes.length);
    const miss = grantMiss(g, inp, nowMs, level);
    if (miss === null) {
      trace.add('delegation', 'PASS', { ref: g.grantId });
      return null;
    }
    trace.add('delegation', 'NO_MATCH', { ref: g.grantId, code: miss });
    misses.add(miss);
  }
  const reason = DELEGATION_SPECIFICITY.find((c) => misses.has(c)) ?? 'DELEGATION_SCOPE_EXCEEDED';
  trace.add('delegation', 'FAIL', { code: reason });
  return reason;
}

function grantMiss(g: DelegatedAuthority, inp: EvaluationInput, nowMs: number, level: number): KnownReasonCode | null {
  const covers =
    g.actions.some((p) => actionMatches(p, inp.request.action)) &&
    g.scopes.some(
      (s) =>
        resourceTypeMatches(s.resourceType, inp.resource.type) &&
        (s.resourceIds === undefined || s.resourceIds.includes(inp.resource.id)),
    );
  if (!covers) return 'DELEGATION_SCOPE_EXCEEDED';
  if (g.revokedAt !== null) return 'DELEGATION_REVOKED';
  if (nowMs >= parseTimestamp(g.expiresAt)) return 'DELEGATION_EXPIRED';
  if (nowMs < parseTimestamp(g.notBefore)) return 'DELEGATION_NOT_YET_VALID';
  if (level > sensitivityLevel(g.maxSensitivity)) return 'DELEGATION_SENSITIVITY_EXCEEDED';
  return null;
}

function ruleApplies(
  rule: PolicyRule,
  action: string,
  resourceType: string,
  level: number,
  nowMs: number,
  scope: AttributeScope,
  budget: Budget,
): 'MATCH' | 'NO_MATCH' | 'INDETERMINATE' {
  budget.spend(rule.actions.length + rule.resourceTypes.length);
  if (!rule.actions.some((p) => actionMatches(p, action))) return 'NO_MATCH';
  if (!rule.resourceTypes.some((p) => resourceTypeMatches(p, resourceType))) return 'NO_MATCH';
  if (rule.sensitivity && !sensitivityInRange(level, rule.sensitivity)) return 'NO_MATCH';
  if (rule.timeWindows && !rule.timeWindows.some((w) => inTimeWindow(nowMs, w))) return 'NO_MATCH';
  if (!rule.when) return 'MATCH';
  const t = evaluateCondition(rule.when, scope, budget);
  if (t === 'TRUE') return 'MATCH';
  if (t === 'FALSE') return 'NO_MATCH';
  // UNKNOWN: restrictive rules apply, permissive rules do not (policy-precedence.md §6).
  return rule.effect === 'ALLOW' ? 'NO_MATCH' : 'INDETERMINATE';
}

function result(
  effect: Effect,
  reasonCodes: KnownReasonCode[],
  policyVersion: string,
  matchedRules: MatchedRule[],
  decisionTtlSeconds: number,
  trace: Trace,
): EngineDecision {
  return {
    effect,
    reasonCodes: [...new Set(reasonCodes)],
    policyVersion,
    matchedRules,
    decisionTtlSeconds,
    approval: null,
    consumesApprovalId: null,
    trace: trace.steps,
  };
}

function deny(
  reasonCodes: KnownReasonCode[],
  policyVersion: string,
  trace: Trace,
  ttl = 1,
  matchedRules: MatchedRule[] = [],
): EngineDecision {
  return result('DENY', reasonCodes, policyVersion, matchedRules, ttl, trace);
}
