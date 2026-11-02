import type { KeyObject } from 'node:crypto';
import type { Attributes } from '@aegis/contracts';
import {
  computeArgumentsDigest,
  computeAttributesDigest,
  verifyExecutionAuthorization,
  type ExecutionAuthorizationClaims,
  type ReplayStore,
} from '@aegis/contracts/crypto';
import { AegisExecutionRejectedError } from './errors.js';

/*
 * SERVER-SIDE enforcement point for protected tools.
 *
 * Run this inside the trusted tool gateway / tool service that holds the downstream credentials — never in
 * the agent process. The agent only ever sees an opaque execution authorization token; the gateway verifies
 * it against what it is actually about to execute, consumes it once, and only then performs the call.
 */

export interface EnforcementPointOptions {
  /** This enforcement point's audience id; tokens minted for other audiences are refused. */
  readonly audience: string;
  /** kid → Ed25519 public key, distributed by configuration (never fetched from token headers). */
  readonly keys: ReadonlyMap<string, KeyObject>;
  /** MUST be shared and atomic across all replicas (e.g. Redis SET NX EX). */
  readonly replayStore: ReplayStore;
  /** Return true when the agent, grant or decision was revoked after issuance. */
  readonly isRevoked?: (claims: ExecutionAuthorizationClaims) => boolean | Promise<boolean>;
  readonly now?: () => Date;
  readonly clockSkewSeconds?: number;
}

export interface ProtectedCall<A> {
  readonly token: unknown;
  /** From the gateway's own authentication of the caller — not from the token or the request body. */
  readonly tenantId: string;
  readonly agentId: string;
  readonly action: string;
  readonly resource: { readonly type: string; readonly id: string };
  readonly args: A;
  readonly principalId?: string;
  /**
   * Re-derives the policy-relevant attributes (e.g. recordCount, destination class) from the arguments
   * actually being executed. Must be the same function the agent side used to build resource.attributes.
   * Strongly recommended whenever the policy reads caller-claimed attributes; without it a lying agent can
   * claim a harmless recordCount while passing harmful arguments.
   */
  readonly deriveAttributes?: (args: Readonly<A>) => Attributes;
}

export function createEnforcementPoint(options: EnforcementPointOptions) {
  return {
    /**
     * Verifies the token for exactly this call and runs `perform` with a frozen snapshot of the arguments
     * (the same snapshot whose digest was verified). Throws AegisExecutionRejectedError otherwise.
     */
    async execute<A, R>(
      call: ProtectedCall<A>,
      perform: (args: Readonly<A>, claims: ExecutionAuthorizationClaims) => Promise<R>,
    ): Promise<R> {
      let snapshot: A;
      let argumentsDigest: string;
      let attributesDigest: string | undefined;
      try {
        snapshot = Object.freeze(structuredClone(call.args));
        argumentsDigest = computeArgumentsDigest(snapshot);
        if (call.deriveAttributes) attributesDigest = computeAttributesDigest(call.deriveAttributes(snapshot));
      } catch {
        throw new AegisExecutionRejectedError('INVALID_ARGUMENTS');
      }
      const result = await verifyExecutionAuthorization(call.token, {
        keys: options.keys,
        replayStore: options.replayStore,
        expected: {
          audience: options.audience,
          tenantId: call.tenantId,
          agentId: call.agentId,
          action: call.action,
          resource: call.resource,
          argumentsDigest,
          ...(call.principalId !== undefined ? { principalId: call.principalId } : {}),
          ...(attributesDigest !== undefined ? { attributesDigest } : {}),
        },
        ...(options.isRevoked ? { isRevoked: options.isRevoked } : {}),
        ...(options.now ? { now: options.now() } : {}),
        ...(options.clockSkewSeconds !== undefined ? { clockSkewSeconds: options.clockSkewSeconds } : {}),
      });
      if (!result.ok) throw new AegisExecutionRejectedError(result.reason, result.field);
      return perform(snapshot, result.claims);
    },
  };
}

export { InMemoryReplayStore, type ReplayStore } from '@aegis/contracts/crypto';
