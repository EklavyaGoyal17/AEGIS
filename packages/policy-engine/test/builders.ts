import type { ApprovalRequest, DelegatedAuthority, PolicyDocument, PolicyRule } from '@aegis/contracts';
import { computeApprovalBindingDigest, computeArgumentsDigest } from '@aegis/contracts/crypto';
import { compilePolicySet, type CompiledPolicySet, type EvaluationInput, type PolicySet } from '../src/index.js';

export const TENANT = 'tnt_acme';
export const NOW = '2026-11-02T10:30:00Z'; // Monday
export const ARGS = { table: 'customers', destination: 's3://partner/x.csv', limit: 15000 };

export function rule(partial: Partial<PolicyRule> & Pick<PolicyRule, 'id' | 'effect'>): PolicyRule {
  return { actions: ['crm.customers.export'], resourceTypes: ['crm.customer_table'], ...partial } as PolicyRule;
}

export function doc(rules: PolicyRule[], extra: Partial<PolicyDocument> = {}): PolicyDocument {
  return { schemaVersion: 'aegis.policy/v1', rules, ...extra };
}

export function policySet(docs: Record<string, PolicyDocument>, tenantId = TENANT, revision = 1): PolicySet {
  return {
    tenantId,
    revision,
    policies: Object.entries(docs).map(([policyId, document]) => ({ policyId, version: 1, document })),
  };
}

export function compiled(set: PolicySet): CompiledPolicySet {
  const c = compilePolicySet(set);
  if (!c.ok) throw new Error(`fixture policy invalid: ${JSON.stringify(c.issues)}`);
  return c;
}

export function grant(overrides: Partial<DelegatedAuthority> = {}): DelegatedAuthority {
  return {
    grantId: 'grant-1',
    tenantId: TENANT,
    agentId: 'agent-crm',
    delegatorPrincipalId: 'usr_alice',
    actions: ['crm.*'],
    scopes: [{ resourceType: 'crm.customer_table' }],
    maxSensitivity: 'confidential',
    notBefore: '2026-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
    revokedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function input(overrides: Partial<EvaluationInput> = {}, resourceAttributes: Record<string, unknown> = {}): EvaluationInput {
  const resource = {
    type: 'crm.customer_table',
    id: 'customers',
    attributes: { recordCount: 500, destination: 'internal', sensitivity: 'confidential', ...resourceAttributes },
  };
  return {
    now: NOW,
    tenantId: TENANT,
    request: {
      requestId: '0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978',
      agentId: 'agent-crm',
      action: 'crm.customers.export',
      resource,
      context: { conversationId: 'conv-1' },
      argumentsDigest: computeArgumentsDigest(ARGS),
    },
    resource,
    agent: {
      agentId: 'agent-crm',
      tenantId: TENANT,
      ownerPrincipalId: 'usr_alice',
      displayName: 'CRM assistant',
      status: 'ACTIVE',
      attributes: { tier: 'standard' },
      credentialRefIds: [],
      createdAt: '2026-01-01T00:00:00Z',
    },
    principal: {
      principalId: 'usr_alice',
      tenantId: TENANT,
      kind: 'HUMAN',
      displayName: 'Alice',
      status: 'ACTIVE',
      attributes: { department: 'sales' },
      createdAt: '2026-01-01T00:00:00Z',
    },
    grants: [grant()],
    environment: { networkZone: 'corp', businessHours: true },
    approval: null,
    ...overrides,
  } as EvaluationInput;
}

/** Same request resumed with an approval id. */
export function withApproval(base: EvaluationInput, approval: Partial<ApprovalRequest> | null, approvalId = '3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c'): EvaluationInput {
  const bindingDigest = computeApprovalBindingDigest({
    tenantId: base.tenantId,
    agentId: base.agent.agentId,
    principalId: base.principal.principalId,
    action: base.request.action,
    resource: base.resource,
    argumentsDigest: base.request.argumentsDigest ?? null,
  });
  const full: ApprovalRequest | null =
    approval === null
      ? null
      : {
          approvalId,
          tenantId: base.tenantId,
          decisionId: '9e8d7c6b-5a49-4382-b716-0f1e2d3c4b5a',
          requestId: base.request.requestId,
          agentId: base.agent.agentId,
          requestingPrincipalId: base.principal.principalId,
          action: base.request.action,
          resource: base.resource,
          argumentsDigest: base.request.argumentsDigest ?? null,
          bindingDigest,
          policyVersion: exportSet().policyVersion,
          matchedRuleIds: [],
          reasonCodes: ['APPROVAL_REQUIRED'],
          status: 'APPROVED',
          createdAt: '2026-11-02T10:00:00Z',
          expiresAt: '2026-11-02T11:00:00Z',
          resolution: {
            decision: 'APPROVE',
            resolvedBy: 'usr_bob_security',
            resolvedAt: '2026-11-02T10:10:00Z',
            comment: null,
            bindingDigest,
          },
          ...approval,
        };
  return { ...base, request: { ...base.request, approvalId }, approval: full };
}

/** The data-export policy used across tests (mirrors contracts/examples/policy-document.json). */
export const exportPolicy = doc([
  rule({ id: 'allow-read', effect: 'ALLOW', actions: ['crm.customers.read'], sensitivity: { max: 'confidential' } }),
  rule({
    id: 'allow-small-internal-export',
    effect: 'ALLOW',
    when: {
      all: [
        { lte: [{ ref: 'resource.attributes.recordCount' }, { value: 1000 }] },
        { eq: [{ ref: 'resource.attributes.destination' }, { value: 'internal' }] },
      ],
    },
  }),
  rule({
    id: 'approve-bulk-or-external',
    effect: 'REQUIRE_APPROVAL',
    when: {
      any: [
        { gt: [{ ref: 'resource.attributes.recordCount' }, { value: 1000 }] },
        { ne: [{ ref: 'resource.attributes.destination' }, { value: 'internal' }] },
      ],
    },
    approval: { ttlSeconds: 3600 },
  }),
  rule({ id: 'deny-restricted-export', effect: 'DENY', resourceTypes: ['*'], sensitivity: { min: 'restricted' } }),
  rule({
    id: 'deny-untrusted-network',
    effect: 'DENY',
    actions: ['*'],
    resourceTypes: ['*'],
    when: { eq: [{ ref: 'env.networkZone' }, { value: 'untrusted' }] },
  }),
], { actionCatalog: ['crm.customers.read', 'crm.customers.export', 'crm.customers.delete'] });

export const exportSet = (): CompiledPolicySet => compiled(policySet({ 'data-export': exportPolicy }));
