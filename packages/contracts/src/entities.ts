import { Type, type Static } from '@sinclair/typebox';
import { LIMITS } from './limits.js';
import {
  ActionName,
  ActionPattern,
  AgentId,
  Attributes,
  CredentialRefId,
  Effect,
  GrantId,
  Identifier,
  PrincipalId,
  ReasonCode,
  ResourceId,
  ResourceKey,
  ResourceRef,
  ResourceTypePattern,
  Sensitivity,
  Sha256Digest,
  TenantId,
  Timestamp,
  Uuid,
} from './primitives.js';

const DisplayName = Type.String({
  minLength: 1,
  maxLength: 200,
  description: 'Human-readable label. NEVER used for authorization or identity matching.',
});

export const Tenant = Type.Object(
  {
    tenantId: TenantId,
    name: DisplayName,
    status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED')]),
    createdAt: Timestamp,
  },
  { $id: 'Tenant' },
);
export type Tenant = Static<typeof Tenant>;

export const Principal = Type.Object(
  {
    principalId: PrincipalId,
    tenantId: TenantId,
    kind: Type.Union([Type.Literal('HUMAN'), Type.Literal('SERVICE')]),
    displayName: DisplayName,
    status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('DISABLED')]),
    attributes: Attributes,
    createdAt: Timestamp,
  },
  {
    $id: 'Principal',
    description: 'Human or service principal. Attributes are server-managed (e.g. from the IdP), never caller-asserted.',
  },
);
export type Principal = Static<typeof Principal>;

export const AgentIdentity = Type.Object(
  {
    agentId: AgentId,
    tenantId: TenantId,
    ownerPrincipalId: PrincipalId,
    displayName: DisplayName,
    status: Type.Union([Type.Literal('ACTIVE'), Type.Literal('SUSPENDED'), Type.Literal('REVOKED')]),
    attributes: Attributes,
    credentialRefIds: Type.Array(CredentialRefId, { maxItems: 32 }),
    createdAt: Timestamp,
  },
  {
    $id: 'AgentIdentity',
    description: 'Registered agent. Authenticated by a credential bound to agentId; model-generated self-descriptions are ignored.',
  },
);
export type AgentIdentity = Static<typeof AgentIdentity>;

export const DelegationScope = Type.Object(
  {
    resourceType: ResourceTypePattern,
    resourceIds: Type.Optional(
      Type.Array(ResourceId, { minItems: 1, maxItems: LIMITS.delegationScopeIdsMax, uniqueItems: true }),
    ),
  },
  { $id: 'DelegationScope', additionalProperties: false, description: 'Omit resourceIds to cover every resource of the type.' },
);
export type DelegationScope = Static<typeof DelegationScope>;

export const DelegatedAuthority = Type.Object(
  {
    grantId: GrantId,
    tenantId: TenantId,
    agentId: AgentId,
    delegatorPrincipalId: PrincipalId,
    actions: Type.Array(ActionPattern, { minItems: 1, maxItems: LIMITS.policyRulePatternsMax }),
    scopes: Type.Array(DelegationScope, { minItems: 1, maxItems: LIMITS.delegationScopesMax }),
    maxSensitivity: Sensitivity,
    notBefore: Timestamp,
    expiresAt: Timestamp,
    revokedAt: Type.Union([Timestamp, Type.Null()]),
    createdAt: Timestamp,
  },
  {
    $id: 'DelegatedAuthority',
    description:
      'Server-managed grant from a principal to an agent. The effective authority of an agent is the intersection ' +
      'of its grants and tenant policy; grants never widen policy and policy never widens grants.',
  },
);
export type DelegatedAuthority = Static<typeof DelegatedAuthority>;

export const CredentialReference = Type.Object(
  {
    credentialRefId: CredentialRefId,
    tenantId: TenantId,
    provider: Type.Union([
      Type.Literal('vault'),
      Type.Literal('aws-secrets-manager'),
      Type.Literal('gcp-secret-manager'),
      Type.Literal('azure-key-vault'),
      Type.Literal('kms'),
      Type.Literal('other'),
    ]),
    locator: Type.String({
      minLength: 1,
      maxLength: 512,
      pattern: '^[^\\s]+$',
      description: 'Where the secret lives (path/ARN). Never the secret value itself.',
    }),
    allowedActions: Type.Array(ActionPattern, { minItems: 1, maxItems: LIMITS.policyRulePatternsMax }),
    createdAt: Timestamp,
    rotatesAt: Type.Union([Timestamp, Type.Null()]),
  },
  {
    $id: 'CredentialReference',
    description:
      'Pointer to a credential held by the enforcement point. Agents never receive the secret; the trusted tool ' +
      'adapter resolves it only after verifying an execution authorization.',
  },
);
export type CredentialReference = Static<typeof CredentialReference>;

export const ExecutionAuthorizationBindings = Type.Object(
  {
    agentId: AgentId,
    action: ActionName,
    resource: ResourceKey,
    argumentsDigest: Type.Union([Sha256Digest, Type.Null()]),
    decisionId: Uuid,
    approvalId: Type.Union([Uuid, Type.Null()]),
    audience: Identifier,
  },
  { $id: 'ExecutionAuthorizationBindings' },
);
export type ExecutionAuthorizationBindings = Static<typeof ExecutionAuthorizationBindings>;

export const ExecutionAuthorization = Type.Object(
  {
    token: Type.String({ minLength: 1, maxLength: LIMITS.executionAuthorizationTokenMaxLength }),
    tokenType: Type.Literal('aegis-ea+jwt'),
    singleUse: Type.Literal(true),
    expiresAt: Timestamp,
    bindings: ExecutionAuthorizationBindings,
  },
  {
    $id: 'ExecutionAuthorization',
    description:
      'Short-lived (<=300s), single-use, Ed25519-signed artifact that a trusted enforcement point verifies before ' +
      'executing exactly the bound action on exactly the bound resource with exactly the bound arguments digest. ' +
      'The bindings object is informational; enforcement MUST rely only on the verified token claims.',
  },
);
export type ExecutionAuthorization = Static<typeof ExecutionAuthorization>;

export const Decision = Type.Object(
  {
    decisionId: Uuid,
    tenantId: TenantId,
    requestId: Uuid,
    agentId: AgentId,
    principalId: PrincipalId,
    action: ActionName,
    resource: ResourceKey,
    argumentsDigest: Type.Union([Sha256Digest, Type.Null()]),
    effect: Effect,
    reasonCodes: Type.Array(ReasonCode, { maxItems: LIMITS.reasonCodesMaxItems }),
    policyVersion: Type.String({ minLength: 1, maxLength: 128 }),
    matchedRuleIds: Type.Array(Type.String({ maxLength: 200 }), { maxItems: LIMITS.policyRulesMax }),
    approvalId: Type.Union([Uuid, Type.Null()]),
    evaluatedAt: Timestamp,
    expiresAt: Timestamp,
  },
  { $id: 'Decision', description: 'Server-side decision record (persisted and audited).' },
);
export type Decision = Static<typeof Decision>;

export const ApprovalStatus = Type.Union(
  [
    Type.Literal('PENDING'),
    Type.Literal('APPROVED'),
    Type.Literal('REJECTED'),
    Type.Literal('EXPIRED'),
    Type.Literal('CANCELLED'),
    Type.Literal('CONSUMED'),
  ],
  { $id: 'ApprovalStatus' },
);
export type ApprovalStatus = Static<typeof ApprovalStatus>;

export const ApprovalResolution = Type.Object(
  {
    decision: Type.Union([Type.Literal('APPROVE'), Type.Literal('REJECT')]),
    resolvedBy: PrincipalId,
    resolvedAt: Timestamp,
    comment: Type.Union([Type.String({ maxLength: LIMITS.commentMaxLength }), Type.Null()]),
    bindingDigest: Sha256Digest,
  },
  { $id: 'ApprovalResolution' },
);
export type ApprovalResolution = Static<typeof ApprovalResolution>;

export const ApprovalRequest = Type.Object(
  {
    approvalId: Uuid,
    tenantId: TenantId,
    decisionId: Uuid,
    requestId: Uuid,
    agentId: AgentId,
    requestingPrincipalId: PrincipalId,
    action: ActionName,
    resource: ResourceRef,
    argumentsDigest: Type.Union([Sha256Digest, Type.Null()]),
    bindingDigest: Sha256Digest,
    policyVersion: Type.String({ minLength: 1, maxLength: 128 }),
    matchedRuleIds: Type.Array(Type.String({ maxLength: 200 }), { maxItems: LIMITS.policyRulesMax }),
    reasonCodes: Type.Array(ReasonCode, { maxItems: LIMITS.reasonCodesMaxItems }),
    status: ApprovalStatus,
    createdAt: Timestamp,
    expiresAt: Timestamp,
    resolution: Type.Union([ApprovalResolution, Type.Null()]),
  },
  {
    $id: 'ApprovalRequest',
    description:
      'Pending human authorization bound (via bindingDigest) to one tenant, agent, principal, action, resource and ' +
      'arguments digest. It can never authorize anything else, and is consumed on first use.',
  },
);
export type ApprovalRequest = Static<typeof ApprovalRequest>;

export const AuditEventType = Type.Union(
  [
    Type.Literal('DECISION_EVALUATED'),
    Type.Literal('APPROVAL_REQUESTED'),
    Type.Literal('APPROVAL_RESOLVED'),
    Type.Literal('APPROVAL_CONSUMED'),
    Type.Literal('APPROVAL_EXPIRED'),
    Type.Literal('EXECUTION_AUTHORIZED'),
    Type.Literal('EXECUTION_REJECTED'),
    Type.Literal('POLICY_CREATED'),
    Type.Literal('POLICY_ACTIVATED'),
    Type.Literal('AUTHENTICATION_FAILED'),
    Type.Literal('AUTHORIZATION_ERROR'),
  ],
  { $id: 'AuditEventType' },
);
export type AuditEventType = Static<typeof AuditEventType>;

export const AuditActor = Type.Object(
  {
    kind: Type.Union([Type.Literal('PRINCIPAL'), Type.Literal('AGENT'), Type.Literal('SYSTEM')]),
    id: Identifier,
  },
  { $id: 'AuditActor', additionalProperties: false },
);
export type AuditActor = Static<typeof AuditActor>;

export const AuditEvent = Type.Object(
  {
    eventId: Uuid,
    tenantId: TenantId,
    sequence: Type.Integer({ minimum: 0, description: 'Gap-free per-tenant sequence number.' }),
    occurredAt: Timestamp,
    type: AuditEventType,
    actor: AuditActor,
    requestId: Type.Union([Uuid, Type.Null()]),
    decisionId: Type.Union([Uuid, Type.Null()]),
    approvalId: Type.Union([Uuid, Type.Null()]),
    policyVersion: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    action: Type.Union([ActionName, Type.Null()]),
    resource: Type.Union([ResourceKey, Type.Null()]),
    effect: Type.Union([Effect, Type.Null()]),
    reasonCodes: Type.Array(ReasonCode, { maxItems: LIMITS.reasonCodesMaxItems }),
    payloadDigest: Sha256Digest,
    previousEventHash: Type.Union([Sha256Digest, Type.Null()]),
    eventHash: Sha256Digest,
  },
  {
    $id: 'AuditEvent',
    description:
      'Append-only, hash-chained audit record. eventHash = sha256(canonical(event without eventHash)); ' +
      'previousEventHash links to the prior event of the same tenant (null only for sequence 0).',
  },
);
export type AuditEvent = Static<typeof AuditEvent>;
