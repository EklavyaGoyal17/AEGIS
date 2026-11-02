import { createHash } from 'node:crypto';
import { z } from 'zod';

export const evaluationSchema = z
  .object({
    requestId: z.uuid(),
    agentId: z.string().min(1).max(128),
    action: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
    resource: z
      .object({
        type: z.string().min(1).max(128),
        id: z.string().min(1).max(256),
        attributes: z.record(z.string(), z.json()).default({}),
      })
      .strict(),
    context: z.record(z.string(), z.json()).default({}),
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
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new DomainError(400, 'INVALID_CANONICAL_VALUE');
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
    trace: z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)).max(128),
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
