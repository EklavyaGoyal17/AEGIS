import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  boundedPolicy,
  digest,
  DomainError,
  requireRole,
  type DecisionResponse,
  type Evaluation,
  type PolicyEngine,
  type Principal,
} from './domain.js';
import { audit, Store, type Tx } from './store.js';

export const resolutionSchema = z
  .object({
    requestId: z.uuid(),
    action: z.enum(['APPROVE', 'REJECT', 'CANCEL']),
  })
  .strict();
export const policyWriteSchema = z
  .object({
    version: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
    document: z.json(),
  })
  .strict();
export interface DecisionRow {
  id: string;
  request_id: string;
  principal_id: string;
  agent_id: string;
  request_digest: string;
  arguments_digest: string;
  action: string;
  resource_type: string;
  resource_id: string;
  policy_version: string;
  effect: DecisionResponse['effect'];
  reasons: string[];
  approval_id: string | null;
  expires_at: Date;
}
export function response(row: DecisionRow): DecisionResponse {
  return {
    decisionId: row.id,
    effect: row.effect,
    reasonCodes: row.reasons,
    policyVersion: row.policy_version,
    approvalId: row.approval_id,
    expiresAt: row.expires_at.toISOString(),
  };
}
export class Authorization {
  constructor(
    readonly store: Store,
    readonly engine: PolicyEngine,
  ) {}
  async evaluate(
    principal: Principal,
    request: Evaluation,
    correlationId: string,
  ): Promise<DecisionResponse> {
    return this.store.transaction(principal.tenantId, async (tx) => {
      await this.store.authorizeAgent(
        tx,
        principal,
        request.agentId,
        request.action,
        request.resource.type,
      );
      const existing = await tx.query<DecisionRow>(
        'SELECT * FROM decisions WHERE tenant_id=$1 AND principal_id=$2 AND request_id=$3',
        [principal.tenantId, principal.id, request.requestId],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_digest !== digest(request))
          throw new DomainError(409, 'IDEMPOTENCY_CONFLICT');
        await audit(
          tx,
          principal.tenantId,
          'DECISION_REPLAY',
          principal.id,
          correlationId,
          { decisionId: existing.rows[0].id },
        );
        return response(existing.rows[0]);
      }
      const policy = await this.policy(tx, principal.tenantId);
      const result = policy
        ? await boundedPolicy(this.engine, {
            tenantId: principal.tenantId,
            principal,
            request,
            policy,
          })
        : {
            effect: 'DENY' as const,
            reasonCodes: ['NO_POLICY'],
            trace: [],
            ttlSeconds: 30,
          };
      const decisionId = randomUUID();
      const approvalId =
        result.effect === 'REQUIRE_APPROVAL' ? randomUUID() : null;
      const expiresAt = new Date(Date.now() + result.ttlSeconds * 1000);
      const version = policy?.version ?? 'none';
      await tx.query(
        `INSERT INTO decisions(tenant_id,id,request_id,principal_id,agent_id,request_digest,arguments_digest,action,resource_type,resource_id,policy_version,effect,reasons,trace,approval_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          principal.tenantId,
          decisionId,
          request.requestId,
          principal.id,
          request.agentId,
          digest(request),
          digest(request.context.arguments ?? null),
          request.action,
          request.resource.type,
          request.resource.id,
          version,
          result.effect,
          JSON.stringify(result.reasonCodes),
          JSON.stringify(result.trace),
          approvalId,
          expiresAt,
        ],
      );
      if (approvalId && result.approval) {
        await tx.query(
          'INSERT INTO approvals(tenant_id,id,decision_id,state,required_role,prohibit_self,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            principal.tenantId,
            approvalId,
            decisionId,
            'PENDING',
            result.approval.requiredRole,
            result.approval.prohibitSelf,
            expiresAt,
          ],
        );
        await audit(
          tx,
          principal.tenantId,
          'APPROVAL_CREATED',
          principal.id,
          correlationId,
          { approvalId, decisionId },
        );
      }
      await audit(
        tx,
        principal.tenantId,
        'DECISION',
        principal.id,
        correlationId,
        {
          decisionId,
          effect: result.effect,
          reasonCodes: result.reasonCodes,
          policyVersion: version,
          requestDigest: digest(request),
        },
      );
      return {
        decisionId,
        effect: result.effect,
        reasonCodes: result.reasonCodes,
        policyVersion: version,
        approvalId,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }
  async policy(
    tx: Tx,
    tenantId: string,
  ): Promise<{ version: string; document: unknown } | null> {
    const row = (
      await tx.query(
        'SELECT p.version,p.document FROM tenants t JOIN policies p ON p.tenant_id=t.id AND p.version=t.active_policy WHERE t.id=$1',
        [tenantId],
      )
    ).rows[0];
    return row ? { version: row.version, document: row.document } : null;
  }
  async expire(tx: Tx, tenantId: string, correlationId: string) {
    const rows = await tx.query(
      "UPDATE approvals SET state='EXPIRED' WHERE tenant_id=$1 AND state IN ('PENDING','APPROVED') AND expires_at<=clock_timestamp() RETURNING id",
      [tenantId],
    );
    for (const row of rows.rows)
      await audit(tx, tenantId, 'APPROVAL_EXPIRED', null, correlationId, {
        approvalId: row.id,
      });
  }
  async resolve(
    principal: Principal,
    approvalId: string,
    input: z.infer<typeof resolutionSchema>,
    correlationId: string,
  ) {
    if (principal.kind !== 'human')
      throw new DomainError(403, 'HUMAN_APPROVER_REQUIRED');
    return this.store.transaction(principal.tenantId, async (tx) => {
      await this.store.currentPrincipal(tx, principal);
      await this.expire(tx, principal.tenantId, correlationId);
      const row = (
        await tx.query(
          `SELECT a.*,d.principal_id,d.policy_version FROM approvals a JOIN decisions d ON d.tenant_id=a.tenant_id AND d.id=a.decision_id
        WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a`,
          [principal.tenantId, approvalId],
        )
      ).rows[0];
      if (!row) throw new DomainError(404, 'APPROVAL_NOT_FOUND');
      requireRole(principal, row.required_role);
      if (row.prohibit_self && row.principal_id === principal.id)
        throw new DomainError(403, 'SELF_APPROVAL_PROHIBITED');
      const existing = (
        await tx.query(
          'SELECT * FROM approval_actions WHERE tenant_id=$1 AND actor_id=$2 AND request_id=$3',
          [principal.tenantId, principal.id, input.requestId],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.approval_id !== approvalId ||
          existing.action !== input.action
        )
          throw new DomainError(409, 'IDEMPOTENCY_CONFLICT');
        return { approvalId, state: row.state as string };
      }
      if (
        row.state !== 'PENDING' &&
        !(row.state === 'APPROVED' && input.action === 'CANCEL')
      )
        throw new DomainError(409, 'APPROVAL_NOT_RESOLVABLE');
      const active = (
        await tx.query('SELECT active_policy FROM tenants WHERE id=$1', [
          principal.tenantId,
        ])
      ).rows[0];
      if (active.active_policy !== row.policy_version)
        throw new DomainError(409, 'POLICY_VERSION_CHANGED');
      const state = {
        APPROVE: 'APPROVED',
        REJECT: 'REJECTED',
        CANCEL: 'CANCELLED',
      }[input.action];
      await tx.query(
        'UPDATE approvals SET state=$3,resolved_by=$4,resolved_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',
        [principal.tenantId, approvalId, state, principal.id],
      );
      await tx.query(
        'INSERT INTO approval_actions(tenant_id,id,approval_id,actor_id,request_id,action) VALUES($1,$2,$3,$4,$5,$6)',
        [
          principal.tenantId,
          randomUUID(),
          approvalId,
          principal.id,
          input.requestId,
          input.action,
        ],
      );
      await audit(
        tx,
        principal.tenantId,
        'APPROVAL_RESOLVED',
        principal.id,
        correlationId,
        { approvalId, state },
      );
      return { approvalId, state };
    });
  }
  async writePolicy(
    principal: Principal,
    input: z.infer<typeof policyWriteSchema>,
    correlationId: string,
  ) {
    requireRole(principal, 'policy:admin');
    let validated = false;
    try {
      validated = await Promise.race([
        this.engine.validatePolicy(input.document),
        new Promise<false>((resolve) => {
          const timer = setTimeout(() => resolve(false), 1500);
          timer.unref();
        }),
      ]);
    } catch {
      throw new DomainError(503, 'POLICY_ENGINE_UNAVAILABLE');
    }
    if (!validated) throw new DomainError(422, 'POLICY_NOT_ACCEPTED');
    return this.store.transaction(principal.tenantId, async (tx) => {
      await this.store.currentPrincipal(tx, principal);
      const existing = (
        await tx.query(
          'SELECT digest FROM policies WHERE tenant_id=$1 AND version=$2',
          [principal.tenantId, input.version],
        )
      ).rows[0];
      if (existing) {
        if (existing.digest !== digest(input.document))
          throw new DomainError(409, 'POLICY_VERSION_CONFLICT');
        return { version: input.version };
      }
      await tx.query(
        'INSERT INTO policies(tenant_id,version,document,digest,created_by) VALUES($1,$2,$3,$4,$5)',
        [
          principal.tenantId,
          input.version,
          JSON.stringify(input.document),
          digest(input.document),
          principal.id,
        ],
      );
      await tx.query('UPDATE tenants SET active_policy=$2 WHERE id=$1', [
        principal.tenantId,
        input.version,
      ]);
      // All outstanding approvals become unusable on policy activation, including a rollback to older semantics.
      const cancelled = await tx.query(
        "UPDATE approvals SET state='CANCELLED' WHERE tenant_id=$1 AND state IN ('PENDING','APPROVED') RETURNING id",
        [principal.tenantId],
      );
      for (const row of cancelled.rows)
        await audit(
          tx,
          principal.tenantId,
          'APPROVAL_CANCELLED',
          principal.id,
          correlationId,
          { approvalId: row.id, reason: 'POLICY_CHANGED' },
        );
      await audit(
        tx,
        principal.tenantId,
        'POLICY_ACTIVATED',
        principal.id,
        correlationId,
        { version: input.version, digest: digest(input.document) },
      );
      return { version: input.version };
    });
  }
}
