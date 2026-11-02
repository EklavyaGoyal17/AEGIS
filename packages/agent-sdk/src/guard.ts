import { randomUUID as nodeRandomUUID } from 'node:crypto';
import {
  CanonicalizationError,
  type Attributes,
  type EvaluateDecisionResponse,
  type ExecutionAuthorization,
  type ResourceRef,
} from '@aegis/contracts';
import { computeArgumentsDigest } from '@aegis/contracts/crypto';
import type { AegisClient, CallOptions } from './client.js';
import {
  AegisApprovalRequiredError,
  AegisAuthorizationExpiredError,
  AegisDeniedError,
  AegisProtocolError,
  AegisValidationError,
} from './errors.js';

export interface ProtectedActionRequest<A> {
  readonly agentId: string;
  readonly action: string;
  readonly resource: ResourceRef;
  /** Caller context. Untrusted by the server; never put secrets here. */
  readonly context?: Attributes;
  /** Exact tool arguments. They are snapshotted, digested, and the snapshot is what the executor receives. */
  readonly args: A;
  /** Resume a request a human approved. The args must be identical to the approved ones. */
  readonly approvalId?: string;
  /** Override for deterministic tests; a fresh UUID is used by default. */
  readonly requestId?: string;
  /**
   * Derives resource.attributes from the args (the same function the trusted gateway uses to verify them).
   * When set, it replaces resource.attributes so claims cannot drift from the arguments.
   */
  readonly deriveAttributes?: (args: Readonly<A>) => Attributes;
}

export interface AuthorizedExecution<A> {
  readonly decision: EvaluateDecisionResponse;
  /** Present when the server issues one; pass it to the trusted tool gateway, which verifies it. */
  readonly executionAuthorization: ExecutionAuthorization | null;
  /** Deep-frozen snapshot of the arguments that were authorized. Execute exactly these. */
  readonly args: Readonly<A>;
  readonly argumentsDigest: string;
}

export interface GuardOptions {
  /**
   * Refuse to execute unless the server returned an execution authorization. Default true: without one
   * there is nothing a downstream enforcement point can verify.
   */
  readonly requireExecutionAuthorization?: boolean;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}

/**
 * Client-side guard for protected tool calls. It never executes on DENY, REQUIRE_APPROVAL, errors,
 * timeouts, malformed responses, or expired authorizations.
 *
 * SECURITY NOTE: this guard runs in the agent's process. A compromised or unintegrated agent can skip it.
 * It is a correctness and audit aid, not an enforcement boundary. Enforcement requires the protected tool
 * to sit behind a trusted gateway that verifies the execution authorization (see ./enforcement).
 */
export class AegisGuard {
  private readonly requireEA: boolean;
  private readonly now: () => number;
  private readonly uuid: () => string;

  constructor(
    private readonly client: AegisClient,
    options: GuardOptions = {},
  ) {
    this.requireEA = options.requireExecutionAuthorization ?? true;
    this.now = options.now ?? Date.now;
    this.uuid = options.randomUUID ?? nodeRandomUUID;
  }

  /** Obtains an ALLOW for exactly these arguments, or throws. */
  async authorize<A>(req: ProtectedActionRequest<A>, opts: CallOptions = {}): Promise<AuthorizedExecution<A>> {
    let snapshot: A;
    let argumentsDigest: string;
    let resource = req.resource;
    try {
      snapshot = deepFreeze(structuredClone(req.args));
      argumentsDigest = computeArgumentsDigest(snapshot);
      if (req.deriveAttributes) resource = { ...req.resource, attributes: req.deriveAttributes(snapshot) };
    } catch (err) {
      const why = err instanceof CanonicalizationError ? err.message : 'arguments are not plain JSON data';
      throw new AegisValidationError(`tool arguments cannot be authorized: ${why}`, []);
    }

    const decision = await this.client.evaluate(
      {
        requestId: req.requestId ?? this.uuid(),
        agentId: req.agentId,
        action: req.action,
        resource,
        context: req.context ?? {},
        argumentsDigest,
        ...(req.approvalId !== undefined ? { approvalId: req.approvalId } : {}),
      },
      opts,
    );

    if (decision.effect === 'DENY') throw new AegisDeniedError(decision, null);
    if (decision.effect === 'REQUIRE_APPROVAL') throw new AegisApprovalRequiredError(decision, null);
    if (decision.effect !== 'ALLOW') throw new AegisProtocolError('unknown effect');

    const ea = decision.executionAuthorization ?? null;
    if (this.requireEA && ea === null) {
      throw new AegisProtocolError('ALLOW without an execution authorization; refusing to execute');
    }
    const auth: AuthorizedExecution<A> = { decision, executionAuthorization: ea, args: snapshot, argumentsDigest };
    this.assertFresh(auth);
    return auth;
  }

  /**
   * Authorizes, then runs `executor` with the authorized snapshot. The executor is called at most once and
   * only after an unexpired ALLOW. Errors thrown by the executor propagate unchanged.
   */
  async execute<A, R>(
    req: ProtectedActionRequest<A>,
    executor: (auth: AuthorizedExecution<A>) => Promise<R>,
    opts: CallOptions = {},
  ): Promise<R> {
    const auth = await this.authorize(req, opts);
    this.assertFresh(auth);
    return executor(auth);
  }

  private assertFresh(auth: AuthorizedExecution<unknown>): void {
    const limits = [Date.parse(auth.decision.expiresAt)];
    if (auth.executionAuthorization) limits.push(Date.parse(auth.executionAuthorization.expiresAt));
    if (limits.some((t) => !Number.isFinite(t) || this.now() >= t)) {
      throw new AegisAuthorizationExpiredError('authorization expired before execution');
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
