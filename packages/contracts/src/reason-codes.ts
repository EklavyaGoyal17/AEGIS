/**
 * Reason codes are machine-readable, stable explanations attached to decisions. The wire format
 * accepts any UPPER_SNAKE_CASE code so that new codes can be added in minor versions; clients
 * MUST treat unknown codes as opaque and MUST NOT derive authorization from them.
 */
export const KNOWN_REASON_CODES = [
  // Rule outcomes
  'POLICY_ALLOW',
  'EXPLICIT_DENY',
  'DEFAULT_DENY',
  'APPROVAL_REQUIRED',
  'CONDITION_INDETERMINATE',
  // Approval lifecycle
  'APPROVAL_SATISFIED',
  'APPROVAL_PENDING',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'APPROVAL_NOT_FOUND',
  'APPROVAL_BINDING_MISMATCH',
  'APPROVAL_ALREADY_CONSUMED',
  'APPROVAL_SELF_RESOLVED',
  'APPROVAL_TENANT_MISMATCH',
  'APPROVAL_POLICY_VERSION_CHANGED',
  // Policy state
  'NO_ACTIVE_POLICY',
  'POLICY_INVALID',
  'POLICY_TENANT_MISMATCH',
  'POLICY_VERSION_MISMATCH',
  'ACTION_UNSUPPORTED',
  // Identity and delegation
  'AGENT_INACTIVE',
  'AGENT_TENANT_MISMATCH',
  'AGENT_IDENTITY_MISMATCH',
  'PRINCIPAL_INACTIVE',
  'PRINCIPAL_TENANT_MISMATCH',
  'DELEGATION_MISSING',
  'DELEGATION_EXPIRED',
  'DELEGATION_NOT_YET_VALID',
  'DELEGATION_REVOKED',
  'DELEGATION_SCOPE_EXCEEDED',
  'DELEGATION_SENSITIVITY_EXCEEDED',
  // Fail-closed
  'INVALID_INPUT',
  'EVALUATION_BUDGET_EXCEEDED',
  'INTERNAL_ERROR',
] as const;

export type KnownReasonCode = (typeof KNOWN_REASON_CODES)[number];

export const REASON_CODE_PATTERN = '^[A-Z][A-Z0-9_]{1,63}$';

const known: ReadonlySet<string> = new Set(KNOWN_REASON_CODES);

export function isKnownReasonCode(code: string): code is KnownReasonCode {
  return known.has(code);
}
