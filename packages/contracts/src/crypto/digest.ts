import { createHash } from 'node:crypto';
import { canonicalJson } from '../canonical.js';
import type { AuditEvent } from '../entities.js';
import type { ResourceKey, Sha256Digest } from '../primitives.js';

/** sha256 over the canonical JSON encoding, formatted as "sha256:<hex>". */
export function sha256Digest(value: unknown): Sha256Digest {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

/**
 * Digest of a tool invocation's arguments. Computed by the agent SDK when requesting a decision and
 * re-computed by the trusted enforcement point from the arguments it is about to execute.
 */
export function computeArgumentsDigest(args: unknown): Sha256Digest {
  return sha256Digest({ kind: 'aegis.arguments/v1', args });
}

export interface ApprovalBindingInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly principalId: string;
  readonly action: string;
  readonly resource: ResourceKey;
  readonly argumentsDigest: Sha256Digest | null;
}

/**
 * The exact thing a human approves. Any difference in tenant, agent, principal, action, resource or
 * arguments yields a different digest, so an approval cannot be replayed for another request.
 */
export function computeApprovalBindingDigest(input: ApprovalBindingInput): Sha256Digest {
  return sha256Digest({
    kind: 'aegis.approval-binding/v1',
    tenantId: input.tenantId,
    agentId: input.agentId,
    principalId: input.principalId,
    action: input.action,
    resource: { type: input.resource.type, id: input.resource.id },
    argumentsDigest: input.argumentsDigest,
  });
}

export type UnhashedAuditEvent = Omit<AuditEvent, 'eventHash'>;

export function computeAuditEventHash(event: UnhashedAuditEvent): Sha256Digest {
  const { eventHash: _ignored, ...rest } = event as AuditEvent;
  return sha256Digest({ kind: 'aegis.audit-event/v1', event: rest });
}

export type AuditChainResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly index: number; readonly reason: 'HASH_MISMATCH' | 'BROKEN_LINK' | 'SEQUENCE_GAP' | 'TENANT_MISMATCH' };

/**
 * Verifies a contiguous slice of one tenant's audit chain. `anchor` is the eventHash that precedes the
 * slice (null when the slice starts at sequence 0). Detects modification, deletion, insertion and
 * reordering inside the slice; truncation of the tail requires an external anchor (see threat model).
 */
export function verifyAuditChain(events: readonly AuditEvent[], anchor: Sha256Digest | null = null): AuditChainResult {
  let previous = anchor;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (i > 0 && event.tenantId !== events[0]!.tenantId) return { ok: false, index: i, reason: 'TENANT_MISMATCH' };
    if (i > 0 && event.sequence !== events[i - 1]!.sequence + 1) return { ok: false, index: i, reason: 'SEQUENCE_GAP' };
    if (event.previousEventHash !== previous) return { ok: false, index: i, reason: 'BROKEN_LINK' };
    if (computeAuditEventHash(event) !== event.eventHash) return { ok: false, index: i, reason: 'HASH_MISMATCH' };
    previous = event.eventHash;
  }
  return { ok: true };
}
