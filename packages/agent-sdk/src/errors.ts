import type { EvaluateDecisionResponse } from '@aegis/contracts';

/**
 * Every SDK failure is an AegisError. None of them ever implies permission: callers that catch an
 * AegisError MUST NOT execute the protected action.
 */
export class AegisError extends Error {
  override readonly name: string = 'AegisError';
  constructor(
    message: string,
    readonly correlationId: string | null = null,
  ) {
    super(message);
  }
}

/** The request was rejected locally before any network call (it does not match the v1 contract). */
export class AegisValidationError extends AegisError {
  override readonly name = 'AegisValidationError';
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

/** The server answered with an error envelope (or an unparseable non-2xx response). */
export class AegisApiError extends AegisError {
  override readonly name = 'AegisApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    correlationId: string | null,
  ) {
    super(`${status} ${code}: ${message}`, correlationId);
  }
}

/** The credential provider failed or the server rejected the credential. */
export class AegisAuthError extends AegisError {
  override readonly name = 'AegisAuthError';
}

/** The service could not be reached or stayed unavailable after the allowed retries. */
export class AegisUnavailableError extends AegisError {
  override readonly name = 'AegisUnavailableError';
}

export class AegisTimeoutError extends AegisError {
  override readonly name = 'AegisTimeoutError';
}

export class AegisCancelledError extends AegisError {
  override readonly name = 'AegisCancelledError';
}

/** The response did not match the contract (wrong shape, inconsistent fields, too large). */
export class AegisProtocolError extends AegisError {
  override readonly name = 'AegisProtocolError';
}

/** The decision was DENY. */
export class AegisDeniedError extends AegisError {
  override readonly name = 'AegisDeniedError';
  constructor(readonly decision: EvaluateDecisionResponse, correlationId: string | null) {
    super(`action denied (${decision.reasonCodes.join(', ') || 'no reason'})`, correlationId);
  }
}

/** The decision was REQUIRE_APPROVAL. Resume with the approvalId once a human has approved. */
export class AegisApprovalRequiredError extends AegisError {
  override readonly name = 'AegisApprovalRequiredError';
  constructor(readonly decision: EvaluateDecisionResponse, correlationId: string | null) {
    super(`human approval required (approvalId ${decision.approvalId})`, correlationId);
  }
  get approvalId(): string {
    return this.decision.approvalId as string;
  }
}

/** An ALLOW (or its execution authorization) expired or was revoked before execution. */
export class AegisAuthorizationExpiredError extends AegisError {
  override readonly name = 'AegisAuthorizationExpiredError';
}

/** A server-side enforcement point refused an execution authorization. */
export class AegisExecutionRejectedError extends AegisError {
  override readonly name = 'AegisExecutionRejectedError';
  constructor(readonly reason: string, readonly field?: string) {
    super(`execution authorization rejected: ${reason}${field ? ` (${field})` : ''}`);
  }
}
