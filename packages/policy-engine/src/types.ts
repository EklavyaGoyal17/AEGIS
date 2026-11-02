import {
  AgentIdentity,
  ApprovalRequest,
  Attributes,
  DelegatedAuthority,
  EvaluateDecisionRequest,
  LIMITS,
  PolicyDocument,
  PolicyId,
  Principal,
  ResourceRef,
  TenantId,
  Timestamp,
  Type,
  type Effect,
  type KnownReasonCode,
  type PolicyRule,
  type TSchema,
} from '@aegis/contracts';

/**
 * Everything the engine needs, assembled by the backend from verified, server-side sources.
 * See docs/security/policy-precedence.md §1 for the trust level of each field.
 */
export interface EvaluationInput {
  now: string;
  tenantId: string;
  request: EvaluateDecisionRequest;
  resource: ResourceRef;
  agent: AgentIdentity;
  principal: Principal;
  grants: DelegatedAuthority[];
  environment: Attributes;
  approval: ApprovalRequest | null;
  expectedPolicyVersion?: string;
}

export const EvaluationInput: TSchema = Type.Object(
  {
    now: Timestamp,
    tenantId: TenantId,
    request: EvaluateDecisionRequest,
    resource: ResourceRef,
    agent: AgentIdentity,
    principal: Principal,
    grants: Type.Array(DelegatedAuthority, { maxItems: LIMITS.delegationGrantsMax }),
    environment: Attributes,
    approval: Type.Union([ApprovalRequest, Type.Null()]),
    expectedPolicyVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export const PolicySetEntry: TSchema = Type.Object(
  {
    policyId: PolicyId,
    version: Type.Integer({ minimum: 1 }),
    document: PolicyDocument,
  },
  { additionalProperties: false },
);

/** The tenant's active policies, as loaded by the backend. `tenantId` is set by the server, never by authors. */
export interface PolicySet {
  tenantId: string;
  revision: number;
  policies: Array<{ policyId: string; version: number; document: PolicyDocument }>;
}

export const PolicySet: TSchema = Type.Object(
  {
    tenantId: TenantId,
    revision: Type.Integer({ minimum: 0, description: 'Monotonic tenant policy-set revision assigned by the server.' }),
    policies: Type.Array(PolicySetEntry, { maxItems: LIMITS.policySetPoliciesMax }),
  },
  { additionalProperties: false },
);

export interface PolicyIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface CompiledRule {
  /** "<policyId>/<ruleId>" — globally unique within the set. */
  readonly key: string;
  readonly policyId: string;
  readonly rule: PolicyRule;
}

export interface CompiledPolicySet {
  readonly ok: true;
  readonly tenantId: string;
  readonly revision: number;
  readonly policyVersion: string;
  readonly rules: readonly CompiledRule[];
  readonly actionCatalog: ReadonlySet<string> | null;
  readonly decisionTtlSeconds: number;
  readonly policyCount: number;
  /** Worst-case evaluation cost in budget units (bounded by MAX_STATIC_COST). */
  readonly staticCost: number;
}

export type CompileResult = CompiledPolicySet | { readonly ok: false; readonly issues: readonly PolicyIssue[] };

export type TraceOutcome = 'PASS' | 'FAIL' | 'MATCH' | 'NO_MATCH' | 'INDETERMINATE' | 'SKIP' | 'RESULT';

/** Trace entries carry identifiers and codes only — never raw request or attribute values. */
export interface TraceStep {
  readonly step: string;
  readonly outcome: TraceOutcome;
  readonly ref?: string;
  readonly code?: string;
}

export interface MatchedRule {
  readonly policyId: string;
  readonly ruleId: string;
  readonly effect: Effect;
  /** True when the rule applied only because its condition was UNKNOWN (fail-safe for DENY/REQUIRE_APPROVAL). */
  readonly indeterminate: boolean;
}

export interface EngineDecision {
  readonly effect: Effect;
  readonly reasonCodes: readonly KnownReasonCode[];
  readonly policyVersion: string;
  readonly matchedRules: readonly MatchedRule[];
  /** How long the backend may report this decision as valid (seconds from input.now). */
  readonly decisionTtlSeconds: number;
  /** Present only when effect is REQUIRE_APPROVAL: what the backend must store on the new ApprovalRequest. */
  readonly approval: { readonly ttlSeconds: number; readonly bindingDigest: string } | null;
  /** Present only when an approval satisfied this ALLOW: the backend MUST atomically mark it CONSUMED. */
  readonly consumesApprovalId: string | null;
  readonly trace: readonly TraceStep[];
}

export interface EvaluateOptions {
  /** Upper bound on evaluation work units; exceeding it yields DENY EVALUATION_BUDGET_EXCEEDED. */
  readonly maxSteps?: number;
}
