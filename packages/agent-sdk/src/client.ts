import { randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  ApprovalPage,
  ApprovalRequest,
  AuditEventPage,
  CreatePolicyRequest,
  ErrorEnvelope,
  EvaluateDecisionRequest,
  EvaluateDecisionResponse,
  HealthResponse,
  isUuid,
  ListApprovalsQuery,
  ListAuditEventsQuery,
  ListPoliciesQuery,
  PolicyPage,
  PolicyVersion,
  ResolveApprovalRequest,
  validate,
  type TSchema,
  type Static,
} from '@aegis/contracts';
import {
  AegisApiError,
  AegisAuthError,
  AegisCancelledError,
  AegisError,
  AegisProtocolError,
  AegisTimeoutError,
  AegisUnavailableError,
  AegisValidationError,
} from './errors.js';
import { noopLogger, safeLog, type Logger } from './logging.js';

/** Supplies a bearer token per attempt (so short-lived tokens can be refreshed). Never logged. */
export interface CredentialProvider {
  getToken(signal: AbortSignal): Promise<string>;
}

export interface RetryOptions {
  /** Total attempts including the first (1–5). Default 3. */
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface AegisClientOptions {
  /** e.g. https://aegis.example.com. Plain http is refused unless allowInsecureHttp (local development). */
  readonly baseUrl: string;
  readonly credentials: CredentialProvider;
  readonly fetch?: typeof fetch;
  /** Per-attempt timeout. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Overall budget for a call including retries and backoff. Default 15000 ms. */
  readonly deadlineMs?: number;
  readonly retry?: RetryOptions;
  readonly logger?: Logger;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
  /** Injection points for deterministic tests. */
  readonly randomUUID?: () => string;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface IdempotentCallOptions extends CallOptions {
  /** Reused across retries; generated if omitted. */
  readonly idempotencyKey?: string;
}

interface RequestSpec<S extends TSchema> {
  readonly op: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
  readonly responseSchema: S;
  /** Safe to repeat: GETs, evaluate (idempotent by requestId), POSTs carrying an Idempotency-Key. */
  readonly idempotent: boolean;
  readonly idempotencyKey?: string;
  readonly authenticated: boolean;
  readonly signal: AbortSignal | undefined;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AegisCancelledError('cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AegisCancelledError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Typed, fail-closed client for the AEGIS v1 API.
 *
 * - Requests are validated against the frozen contract before sending; responses are validated on receipt.
 * - Retries only explicitly transient failures (network errors, timeouts, 429/502/503/504) and only for
 *   idempotent operations, with jittered exponential backoff inside an overall deadline.
 * - Redirects are refused so the bearer token is never forwarded to another origin.
 * - Every failure throws an AegisError. Nothing in this client ever substitutes a permissive default.
 */
export class AegisClient {
  private readonly base: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly deadlineMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly logger: Logger;
  private readonly maxResponseBytes: number;
  private readonly uuid: () => string;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly options: AegisClientOptions) {
    let base: URL;
    try {
      base = new URL(options.baseUrl);
    } catch {
      throw new AegisValidationError('baseUrl is not a valid URL', []);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && (options.allowInsecureHttp || local))) {
      throw new AegisValidationError('baseUrl must use https', []);
    }
    if (base.username || base.password) throw new AegisValidationError('baseUrl must not embed credentials', []);
    this.base = base;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.deadlineMs = options.deadlineMs ?? 15000;
    this.maxAttempts = Math.min(Math.max(options.retry?.maxAttempts ?? 3, 1), 5);
    this.baseDelayMs = options.retry?.baseDelayMs ?? 100;
    this.maxDelayMs = options.retry?.maxDelayMs ?? 2000;
    this.logger = options.logger ?? noopLogger;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.uuid = options.randomUUID ?? nodeRandomUUID;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** POST /v1/decisions/evaluate. Idempotent by requestId, so it is retried with the same body. */
  async evaluate(request: EvaluateDecisionRequest, opts: CallOptions = {}): Promise<EvaluateDecisionResponse> {
    this.check(EvaluateDecisionRequest, request, 'evaluate request');
    const response = await this.call({
      op: 'evaluate',
      method: 'POST',
      path: '/v1/decisions/evaluate',
      body: request,
      responseSchema: EvaluateDecisionResponse,
      idempotent: true,
      authenticated: true,
      signal: opts.signal,
    });
    assertDecisionConsistent(request, response);
    return response;
  }

  async resolveApproval(
    approvalId: string,
    body: ResolveApprovalRequest,
    opts: IdempotentCallOptions = {},
  ): Promise<ApprovalRequest> {
    if (!isUuid(approvalId)) throw new AegisValidationError('approvalId must be a canonical UUID', []);
    this.check(ResolveApprovalRequest, body, 'resolve request');
    const response = await this.call({
      op: 'resolveApproval',
      method: 'POST',
      path: `/v1/approvals/${approvalId}/resolve`,
      body,
      responseSchema: ApprovalRequest,
      idempotent: true,
      idempotencyKey: opts.idempotencyKey ?? this.uuid(),
      authenticated: true,
      signal: opts.signal,
    });
    if (response.approvalId !== approvalId) throw new AegisProtocolError('response is for a different approval');
    return response;
  }

  async listApprovals(query: ListApprovalsQuery = {}, opts: CallOptions = {}): Promise<ApprovalPage> {
    this.check(ListApprovalsQuery, query, 'query');
    return this.call({ op: 'listApprovals', method: 'GET', path: '/v1/approvals', query, responseSchema: ApprovalPage, idempotent: true, authenticated: true, signal: opts.signal });
  }

  async listAuditEvents(query: ListAuditEventsQuery = {}, opts: CallOptions = {}): Promise<AuditEventPage> {
    this.check(ListAuditEventsQuery, query, 'query');
    return this.call({ op: 'listAuditEvents', method: 'GET', path: '/v1/audit/events', query, responseSchema: AuditEventPage, idempotent: true, authenticated: true, signal: opts.signal });
  }

  async listPolicies(query: ListPoliciesQuery = {}, opts: CallOptions = {}): Promise<PolicyPage> {
    this.check(ListPoliciesQuery, query, 'query');
    return this.call({ op: 'listPolicies', method: 'GET', path: '/v1/policies', query, responseSchema: PolicyPage, idempotent: true, authenticated: true, signal: opts.signal });
  }

  async createPolicy(body: CreatePolicyRequest, opts: IdempotentCallOptions = {}): Promise<PolicyVersion> {
    this.check(CreatePolicyRequest, body, 'policy request');
    return this.call({
      op: 'createPolicy',
      method: 'POST',
      path: '/v1/policies',
      body,
      responseSchema: PolicyVersion,
      idempotent: true,
      idempotencyKey: opts.idempotencyKey ?? this.uuid(),
      authenticated: true,
      signal: opts.signal,
    }) as Promise<PolicyVersion>;
  }

  /** Unauthenticated. A 200 with status "degraded" is returned; a 503 throws AegisUnavailableError. */
  async health(opts: CallOptions = {}): Promise<HealthResponse> {
    return this.call({ op: 'health', method: 'GET', path: '/v1/health', responseSchema: HealthResponse, idempotent: true, authenticated: false, signal: opts.signal });
  }

  private check(schema: TSchema, value: unknown, what: string): void {
    const result = validate(schema, value);
    if (!result.ok) throw new AegisValidationError(`${what} does not match the AEGIS v1 contract`, result.issues);
  }

  private async call<S extends TSchema>(spec: RequestSpec<S>): Promise<Static<S>> {
    const correlationId = this.uuid();
    const deadline = this.now() + this.deadlineMs;
    const attempts = spec.idempotent ? this.maxAttempts : 1;
    let lastError: AegisError = new AegisUnavailableError('no attempt made', correlationId);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (spec.signal?.aborted) throw new AegisCancelledError('cancelled', correlationId);
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new AegisTimeoutError(`deadline of ${this.deadlineMs} ms exceeded`, correlationId);

      const started = this.now();
      const outcome = await this.attempt(spec, correlationId, Math.min(this.timeoutMs, remaining));
      safeLog(this.logger, outcome.ok ? 'debug' : 'warn', 'aegis.request', {
        op: spec.op,
        attempt,
        correlationId,
        durationMs: this.now() - started,
        outcome: outcome.ok ? 'ok' : outcome.error.name,
        status: outcome.ok ? outcome.status : outcome.error instanceof AegisApiError ? outcome.error.status : null,
      });
      if (outcome.ok) return outcome.value;

      lastError = outcome.error;
      if (!outcome.retryable || attempt === attempts) break;
      const backoff = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1)) * this.random();
      const delay = outcome.retryAfterMs ?? backoff;
      if (this.now() + delay >= deadline) break;
      await this.sleep(delay, spec.signal).catch(() => {
        throw new AegisCancelledError('cancelled', correlationId);
      });
    }
    throw lastError;
  }

  private async attempt<S extends TSchema>(
    spec: RequestSpec<S>,
    correlationId: string,
    timeoutMs: number,
  ): Promise<
    | { ok: true; value: Static<S>; status: number }
    | { ok: false; error: AegisError; retryable: boolean; retryAfterMs?: number }
  > {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onUserAbort = () => controller.abort();
    spec.signal?.addEventListener('abort', onUserAbort, { once: true });

    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-correlation-id': correlationId,
      };
      if (spec.body !== undefined) headers['content-type'] = 'application/json';
      if (spec.idempotencyKey) headers['idempotency-key'] = spec.idempotencyKey;
      if (spec.authenticated) {
        let token: string;
        try {
          token = await this.options.credentials.getToken(controller.signal);
        } catch {
          if (spec.signal?.aborted) return { ok: false, error: new AegisCancelledError('cancelled', correlationId), retryable: false };
          return { ok: false, error: new AegisAuthError('credential provider failed', correlationId), retryable: false };
        }
        if (typeof token !== 'string' || token.length === 0 || /[\r\n\s]/.test(token)) {
          return { ok: false, error: new AegisAuthError('credential provider returned an invalid token', correlationId), retryable: false };
        }
        headers['authorization'] = `Bearer ${token}`;
      }

      const url = new URL(spec.path, this.base);
      for (const [k, v] of Object.entries(spec.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

      const init: RequestInit = { method: spec.method, headers, signal: controller.signal, redirect: 'error' };
      if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
      const res = await this.fetchImpl(url, init);
      const text = await readBounded(res, this.maxResponseBytes);
      const responseCorrelation = res.headers.get('x-correlation-id') ?? correlationId;

      if (res.status >= 200 && res.status < 300) {
        if (!(res.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
          return { ok: false, error: new AegisProtocolError('response is not JSON', responseCorrelation), retryable: false };
        }
        const parsed = parseJson(text);
        const checked = validate(spec.responseSchema, parsed);
        if (!checked.ok) {
          return { ok: false, error: new AegisProtocolError('response does not match the AEGIS v1 contract', responseCorrelation), retryable: false };
        }
        return { ok: true, value: checked.value, status: res.status };
      }
      return { ok: false, ...this.classifyError(res, text, responseCorrelation, spec.idempotent) };
    } catch (err) {
      if (spec.signal?.aborted) return { ok: false, error: new AegisCancelledError('cancelled', correlationId), retryable: false };
      if (timedOut) return { ok: false, error: new AegisTimeoutError(`attempt timed out after ${timeoutMs} ms`, correlationId), retryable: spec.idempotent };
      if (err instanceof AegisError) return { ok: false, error: err, retryable: false };
      return { ok: false, error: new AegisUnavailableError('AEGIS service unreachable', correlationId), retryable: spec.idempotent };
    } finally {
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onUserAbort);
    }
  }

  private classifyError(
    res: Response,
    text: string,
    correlationId: string,
    idempotent: boolean,
  ): { error: AegisError; retryable: boolean; retryAfterMs?: number } {
    const envelope = validate(ErrorEnvelope, parseJson(text));
    const code = envelope.ok ? envelope.value.error.code : `HTTP_${res.status}`;
    const message = envelope.ok ? envelope.value.error.message : 'unexpected error response';
    if (res.status === 401) return { error: new AegisAuthError(`${code}: ${message}`, correlationId), retryable: false };
    // Transient only if the status says so AND the server did not explicitly say "do not retry".
    const transient = RETRYABLE_STATUS.has(res.status) && (!envelope.ok || envelope.value.error.retryable);
    const retryable = transient && idempotent;
    // The error type follows the status class; whether to retry is decided separately above.
    const error = res.status >= 502 && res.status <= 504
      ? new AegisUnavailableError(`${res.status} ${code}: ${message}`, correlationId)
      : new AegisApiError(res.status, code, message, transient, correlationId);
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'), this.maxDelayMs);
    return retryAfter === undefined ? { error, retryable } : { error, retryable, retryAfterMs: retryAfter };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(value: string | null, maxMs: number): number | undefined {
  if (value === null || !/^\d{1,6}$/.test(value.trim())) return undefined;
  return Math.min(Number(value) * 1000, maxMs);
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AegisProtocolError('response too large');
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      // Not awaited: cancelling a tee'd or back-pressured stream can block indefinitely.
      void reader.cancel().catch(() => undefined);
      throw new AegisProtocolError('response too large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks));
}

/** Rejects decisions whose fields contradict each other or the request they answer. */
function assertDecisionConsistent(req: EvaluateDecisionRequest, res: EvaluateDecisionResponse): void {
  if (res.effect === 'REQUIRE_APPROVAL' && res.approvalId === null) {
    throw new AegisProtocolError('REQUIRE_APPROVAL without approvalId');
  }
  const ea = res.executionAuthorization;
  if (ea) {
    const b = ea.bindings;
    const consistent =
      res.effect === 'ALLOW' &&
      b.decisionId === res.decisionId &&
      b.agentId === req.agentId &&
      b.action === req.action &&
      b.resource.type === req.resource.type &&
      b.resource.id === req.resource.id &&
      b.argumentsDigest === (req.argumentsDigest ?? null);
    if (!consistent) throw new AegisProtocolError('execution authorization does not match the request');
  }
}
