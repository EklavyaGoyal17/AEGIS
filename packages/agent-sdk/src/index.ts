export {
  AegisClient,
  type AegisClientOptions,
  type CallOptions,
  type CredentialProvider,
  type IdempotentCallOptions,
  type RetryOptions,
} from './client.js';
export { AegisGuard, type AuthorizedExecution, type GuardOptions, type ProtectedActionRequest } from './guard.js';
export {
  AegisApiError,
  AegisApprovalRequiredError,
  AegisAuthError,
  AegisAuthorizationExpiredError,
  AegisCancelledError,
  AegisDeniedError,
  AegisError,
  AegisExecutionRejectedError,
  AegisProtocolError,
  AegisTimeoutError,
  AegisUnavailableError,
  AegisValidationError,
} from './errors.js';
export { jsonLogger, noopLogger, redact, type Logger, type LogLevel } from './logging.js';
