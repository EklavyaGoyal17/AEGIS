import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { LIMITS } from './limits.js';
import { ApprovalRequest, ApprovalStatus, AuditEvent, AuditEventType, ExecutionAuthorization } from './entities.js';
import { Policy } from './policy.js';
import {
  ActionName,
  AgentId,
  Attributes,
  Effect,
  ReasonCode,
  ResourceRef,
  Sha256Digest,
  Timestamp,
  Uuid,
} from './primitives.js';

export const API_VERSION = '1.0.0';

// ---------------------------------------------------------------------------------------------
// POST /v1/decisions/evaluate
// ---------------------------------------------------------------------------------------------

export const EvaluateDecisionRequest = Type.Object(
  {
    // Idempotency key: same requestId + identical body => same decision; different body => 409 IDEMPOTENCY_CONFLICT.
    requestId: Uuid,
    agentId: AgentId,
    action: ActionName,
    resource: ResourceRef,
    context: Attributes,
    argumentsDigest: Type.Optional(Sha256Digest),
    approvalId: Type.Optional(Uuid),
  },
  {
    $id: 'EvaluateDecisionRequest',
    additionalProperties: false,
    description:
      'Agent request for a decision. It carries no tenant, principal, role or permission: those are derived by the ' +
      'server from the verified credential and server-managed grants. `context` is caller-supplied and untrusted. ' +
      '`argumentsDigest` (optional in v1, REQUIRED by servers for tools that return execution authorizations) binds ' +
      'the decision to the exact tool arguments. `approvalId` resumes a previously approved request.',
  },
);
export type EvaluateDecisionRequest = Static<typeof EvaluateDecisionRequest>;

export const EvaluateDecisionResponse = Type.Object(
  {
    decisionId: Uuid,
    effect: Effect,
    reasonCodes: Type.Array(ReasonCode, { maxItems: LIMITS.reasonCodesMaxItems }),
    policyVersion: Type.String({ minLength: 1, maxLength: 128 }),
    approvalId: Type.Union([Uuid, Type.Null()], {
      description: 'Set when effect is REQUIRE_APPROVAL (the pending approval) or when an approval was consumed.',
    }),
    expiresAt: Timestamp,
    executionAuthorization: Type.Optional(
      Type.Union([ExecutionAuthorization, Type.Null()], {
        description: 'Present only when effect is ALLOW and the server issues execution artifacts for this action.',
      }),
    ),
  },
  {
    $id: 'EvaluateDecisionResponse',
    description:
      'A decision is advisory to the caller and authoritative only at an enforcement point. expiresAt bounds how long ' +
      'an ALLOW may be relied upon; it is never a reusable credential.',
  },
);
export type EvaluateDecisionResponse = Static<typeof EvaluateDecisionResponse>;

// ---------------------------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------------------------

export const ResolveApprovalRequest = Type.Object(
  {
    decision: Type.Union([Type.Literal('APPROVE'), Type.Literal('REJECT')]),
    expectedBindingDigest: Sha256Digest,
    comment: Type.Optional(Type.String({ maxLength: LIMITS.commentMaxLength })),
  },
  {
    $id: 'ResolveApprovalRequest',
    additionalProperties: false,
    description:
      'The approver echoes the bindingDigest of the request they reviewed. The server rejects the resolution with ' +
      '409 APPROVAL_BINDING_MISMATCH if it differs, so an approver can never approve something other than what they saw. ' +
      'Requires scope aegis:approvals:resolve; the requesting principal and the agent may not resolve their own approvals.',
  },
);
export type ResolveApprovalRequest = Static<typeof ResolveApprovalRequest>;

const page = <T extends TSchema>(item: T, id: string) =>
  Type.Object(
    {
      items: Type.Array(item, { maxItems: LIMITS.pageSizeMax }),
      nextCursor: Type.Union([Type.String({ minLength: 1, maxLength: LIMITS.cursorMaxLength }), Type.Null()]),
    },
    { $id: id },
  );

export const ApprovalPage = page(ApprovalRequest, 'ApprovalPage');
export type ApprovalPage = Static<typeof ApprovalPage>;

export const AuditEventPage = page(AuditEvent, 'AuditEventPage');
export type AuditEventPage = Static<typeof AuditEventPage>;

export const PolicyPage = page(Policy, 'PolicyPage');
export type PolicyPage = Static<typeof PolicyPage>;

const Limit = Type.Integer({ minimum: 1, maximum: LIMITS.pageSizeMax, default: LIMITS.pageSizeDefault });
const Cursor = Type.String({ minLength: 1, maxLength: LIMITS.cursorMaxLength, description: 'Opaque, server-signed cursor.' });

export const ListApprovalsQuery = Type.Object(
  {
    status: Type.Optional(ApprovalStatus),
    agentId: Type.Optional(AgentId),
    limit: Type.Optional(Limit),
    cursor: Type.Optional(Cursor),
  },
  { $id: 'ListApprovalsQuery', additionalProperties: false },
);
export type ListApprovalsQuery = Static<typeof ListApprovalsQuery>;

export const ListAuditEventsQuery = Type.Object(
  {
    from: Type.Optional(Timestamp),
    to: Type.Optional(Timestamp),
    type: Type.Optional(AuditEventType),
    agentId: Type.Optional(AgentId),
    decisionId: Type.Optional(Uuid),
    limit: Type.Optional(Limit),
    cursor: Type.Optional(Cursor),
  },
  { $id: 'ListAuditEventsQuery', additionalProperties: false },
);
export type ListAuditEventsQuery = Static<typeof ListAuditEventsQuery>;

export const ListPoliciesQuery = Type.Object(
  {
    limit: Type.Optional(Limit),
    cursor: Type.Optional(Cursor),
  },
  { $id: 'ListPoliciesQuery', additionalProperties: false },
);
export type ListPoliciesQuery = Static<typeof ListPoliciesQuery>;

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

export const HealthResponse = Type.Object(
  {
    status: Type.Union([Type.Literal('ok'), Type.Literal('degraded'), Type.Literal('unavailable')]),
    apiVersion: Type.String({ maxLength: 32 }),
    time: Timestamp,
  },
  {
    $id: 'HealthResponse',
    description: 'Unauthenticated liveness/readiness. MUST NOT reveal tenant data, dependency hostnames or versions of internals.',
  },
);
export type HealthResponse = Static<typeof HealthResponse>;

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'APPROVAL_BINDING_MISMATCH',
  'APPROVAL_NOT_PENDING',
  'SELF_APPROVAL_FORBIDDEN',
  'POLICY_INVALID',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
  'UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes that a client MAY retry (with backoff, reusing the same requestId / Idempotency-Key). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['RATE_LIMITED', 'UNAVAILABLE']);

export const ErrorDetail = Type.Object(
  {
    field: Type.String({ maxLength: 256, description: 'JSON Pointer to the offending field, when applicable.' }),
    issue: Type.String({ maxLength: 512 }),
  },
  { $id: 'ErrorDetail' },
);

export const ErrorEnvelope = Type.Object(
  {
    error: Type.Object({
      code: Type.String({ pattern: '^[A-Z][A-Z0-9_]{1,63}$', description: 'One of ERROR_CODES; unknown codes must be treated as non-retryable.' }),
      message: Type.String({ maxLength: 1024, description: 'Human-readable. Never contains secrets, stack traces or other tenants\' data.' }),
      correlationId: Type.String({ minLength: 1, maxLength: 128 }),
      retryable: Type.Boolean(),
      details: Type.Optional(Type.Array(ErrorDetail, { maxItems: 50 })),
    }),
  },
  {
    $id: 'ErrorEnvelope',
    description: 'Every non-2xx response uses this envelope. HTTP status and error.code are both normative.',
  },
);
export type ErrorEnvelope = Static<typeof ErrorEnvelope>;
