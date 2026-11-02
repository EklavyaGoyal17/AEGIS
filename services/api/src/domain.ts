import { createHash } from 'node:crypto';
import { z } from 'zod';

export const identifier = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
export const sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const scalar = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const attributesSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    z.union([scalar, z.array(scalar).max(256)]),
  )
  .refine((value) => Object.keys(value).length <= 64);
export const evaluationSchema = z
  .object({
    requestId: z.uuid(),
    agentId: identifier,
    action: z
      .string()
      .max(128)
      .regex(/^[a-z][a-z0-9_-]{0,62}(\.[a-z][a-z0-9_-]{0,62}){1,4}$/),
    resource: z
      .object({
        type: z
          .string()
          .max(128)
          .regex(/^[a-z][a-z0-9_-]{0,62}(\.[a-z][a-z0-9_-]{0,62}){0,3}$/),
        id: z
          .string()
          .min(1)
          .max(256)
          .regex(/^[^\u0000-\u001f\u007f]+$/),
        attributes: attributesSchema,
      })
      .strict(),
    context: attributesSchema,
    argumentsDigest: sha256Schema.optional(),
    approvalId: z.uuid().optional(),
  })
  .strict();
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Effect = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
export interface Principal {
  tenantId: string;
  id: string;
  issuer: string;
  subject: string;
  kind: 'human' | 'machine';
  roles: string[];
  connector: boolean;
}
export interface DecisionResponse {
  decisionId: string;
  effect: Effect;
  reasonCodes: string[];
  policyVersion: string;
  approvalId: string | null;
  expiresAt: string;
}
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function canonical(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): string {
  if (depth > 32) throw new DomainError(400, 'CANONICAL_DEPTH_EXCEEDED');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) throw new DomainError(400, 'CANONICAL_CYCLE');
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) throw new DomainError(400, 'SPARSE_ARRAY');
          items.push(canonical(value[i], depth + 1, seen));
        }
        return `[${items.join(',')}]`;
      }
      if (
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length
      )
        throw new DomainError(400, 'NON_PLAIN_OBJECT');
      const object = value as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonical(object[key], depth + 1, seen)}`,
        )
        .join(',')}}`;
    } finally {
      seen.delete(value);
    }
  }
  throw new DomainError(400, 'INVALID_CANONICAL_VALUE');
}
export function publicDigest(value: unknown) {
  return `sha256:${digest(value)}`;
}
export function argumentsDigest(args: unknown) {
  return publicDigest({ kind: 'aegis.arguments/v1', args });
}
export function approvalBinding(
  principal: Principal,
  row: {
    agent_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    arguments_digest: string;
  },
) {
  return publicDigest({
    kind: 'aegis.approval-binding/v1',
    tenantId: principal.tenantId,
    agentId: row.agent_id,
    principalId: principal.id,
    action: row.action,
    resource: { type: row.resource_type, id: row.resource_id },
    argumentsDigest:
      row.arguments_digest === 'none' ? null : row.arguments_digest,
  });
}
export function digest(value: unknown) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function requireRole(principal: Principal, role: string) {
  if (!principal.roles.includes(role))
    throw new DomainError(403, 'INSUFFICIENT_AUTHORITY');
}
export const policyResultSchema = z
  .object({
    effect: z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']),
    reasonCodes: z.array(z.string().regex(/^[A-Z0-9_]{1,64}$/)).max(32),
    // Trace contains rule identifiers only; policy engines must not return raw request data.
    trace: z.array(z.string().regex(/^[A-Za-z0-9_./:-]{1,200}$/)).max(256),
    ttlSeconds: z.number().int().min(1).max(300),
    approval: z
      .object({
        requiredRole: z.string().regex(/^[a-z][a-z0-9:_-]{0,63}$/),
        prohibitSelf: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (result) =>
      result.effect !== 'REQUIRE_APPROVAL' || result.approval !== undefined,
  );
export type PolicyResult = z.infer<typeof policyResultSchema>;
export interface PolicyEngine {
  readonly name: string;
  validatePolicy(document: unknown): Promise<boolean>;
  evaluate(input: {
    tenantId: string;
    principal: Principal;
    request: Evaluation;
    policy: { version: string; document: unknown } | null;
    signal: AbortSignal;
  }): Promise<PolicyResult>;
}
/** Integration seam for Claude's engine. Never grants authorization. */
export class UnavailablePolicyEngine implements PolicyEngine {
  readonly name = 'unconfigured-fail-closed';
  async validatePolicy() {
    return false;
  }
  async evaluate(
    input: Parameters<PolicyEngine['evaluate']>[0],
  ): Promise<PolicyResult> {
    if (input.policy) throw new DomainError(503, 'POLICY_ENGINE_UNAVAILABLE');
    return {
      effect: 'DENY',
      reasonCodes: ['NO_POLICY'],
      trace: [],
      ttlSeconds: 30,
    };
  }
}
export async function boundedPolicy(
  engine: PolicyEngine,
  input: Omit<Parameters<PolicyEngine['evaluate']>[0], 'signal'>,
): Promise<PolicyResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      engine.evaluate({ ...input, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DomainError(503, 'POLICY_ENGINE_TIMEOUT'));
        }, 1500);
      }),
    ]);
    return policyResultSchema.parse(result);
  } catch {
    throw new DomainError(503, 'POLICY_ENGINE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}
