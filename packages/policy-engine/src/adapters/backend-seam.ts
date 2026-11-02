import type {
  AgentIdentity,
  ApprovalRequest,
  Attributes,
  DelegatedAuthority,
  Effect,
  Principal,
  ResourceRef,
} from '@aegis/contracts';
import { compilePolicySet } from '../compile.js';
import { evaluate } from '../evaluate.js';
import type { EngineDecision, PolicySet } from '../types.js';

/*
 * Adapter for the backend's `PolicyEngine` integration seam (services/api/src/domain.ts on
 * agent/codex-backend). Types are declared structurally here so this package does not depend on the
 * backend. The adapter performs I/O only through the injected `loadContext`; the engine stays pure.
 */

export interface BackendPolicyResult {
  effect: Effect;
  reasonCodes: string[];
  trace: string[];
  ttlSeconds: number;
  approval?: { requiredRole: string; prohibitSelf: boolean };
}

export interface BackendEvaluateArgs {
  tenantId: string;
  principal: { tenantId: string; id: string };
  request: unknown;
  policy: { version: string; document: unknown } | null;
  signal: AbortSignal;
}

export interface LoadedContext {
  agent: AgentIdentity;
  /** The principal the agent acts for (the delegator), from the server registry. */
  principal: Principal;
  grants: DelegatedAuthority[];
  environment: Attributes;
  approval: ApprovalRequest | null;
  /** Server-resolved resource (catalog attributes merged over caller claims). Defaults to request.resource. */
  resource?: ResourceRef;
}

export interface BackendAdapterOptions {
  loadContext(args: { tenantId: string; principalId: string; request: unknown; signal: AbortSignal }): Promise<LoadedContext>;
  /** Injected clock; defaults to the system clock. */
  clock?: () => Date;
  /** Role the backend requires of approvers. */
  approverRole?: string;
  /** Revision number to report for single-document policies. */
  revision?: number;
}

const TRACE_ITEM = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_TTL = 300;

export function createBackendPolicyEngine(options: BackendAdapterOptions) {
  const clock = options.clock ?? (() => new Date());
  const approverRole = options.approverRole ?? 'approver';

  const toPolicySet = (tenantId: string, document: unknown): unknown => {
    if (document && typeof document === 'object' && Array.isArray((document as { policies?: unknown }).policies)) {
      return document; // already a PolicySet; its tenantId is checked by the engine
    }
    return { tenantId, revision: options.revision ?? 0, policies: [{ policyId: 'tenant-policy', version: 1, document }] };
  };

  return {
    name: '@aegis/policy-engine',

    async validatePolicy(document: unknown): Promise<boolean> {
      // Validated against a placeholder tenant: tenant binding is enforced at evaluation time.
      return compilePolicySet(toPolicySet('validation-tenant', document)).ok;
    },

    async evaluate(args: BackendEvaluateArgs): Promise<BackendPolicyResult> {
      if (args.signal.aborted) throw new Error('aborted');
      if (args.policy === null) return toBackend(denyNoPolicy());
      const request = args.request as { resource?: ResourceRef } | null;
      const ctx = await options.loadContext({
        tenantId: args.tenantId,
        principalId: args.principal.id,
        request: args.request,
        signal: args.signal,
      });
      if (args.signal.aborted) throw new Error('aborted');
      const decision = evaluate(toPolicySet(args.tenantId, args.policy.document), {
        now: clock().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        tenantId: args.tenantId,
        request: args.request,
        resource: ctx.resource ?? request?.resource,
        agent: ctx.agent,
        principal: ctx.principal,
        grants: ctx.grants,
        environment: ctx.environment,
        approval: ctx.approval,
      });
      return toBackend(decision);
    },
  };

  function toBackend(d: EngineDecision): BackendPolicyResult {
    const trace = d.matchedRules
      .map((m) => `${m.policyId}:${m.ruleId}`)
      .filter((t) => TRACE_ITEM.test(t))
      .slice(0, 128);
    const ttlSeconds = Math.max(1, Math.min(MAX_TTL, d.approval ? d.approval.ttlSeconds : d.decisionTtlSeconds));
    return {
      effect: d.effect,
      reasonCodes: [...d.reasonCodes].slice(0, 32),
      trace,
      ttlSeconds,
      ...(d.effect === 'REQUIRE_APPROVAL' ? { approval: { requiredRole: approverRole, prohibitSelf: true } } : {}),
    };
  }
}

function denyNoPolicy(): EngineDecision {
  return {
    effect: 'DENY',
    reasonCodes: ['NO_ACTIVE_POLICY'],
    policyVersion: 'none',
    matchedRules: [],
    decisionTtlSeconds: 1,
    approval: null,
    consumesApprovalId: null,
    trace: [{ step: 'policy.present', outcome: 'FAIL', code: 'NO_ACTIVE_POLICY' }],
  };
}
