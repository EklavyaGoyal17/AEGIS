import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  approvalBinding,
  boundedPolicy,
  digest,
  DomainError,
  identifier,
  publicDigest,
  requireRole,
  sha256Schema,
  type DecisionResponse,
  type Evaluation,
  type PolicyEngine,
  type Principal,
} from './domain.js';
import { audit, Store, type Tx } from './store.js';

export const resolutionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    expectedBindingDigest: sha256Schema,
    comment: z.string().max(2000).optional(),
  })
  .strict();
export const policyWriteSchema = z
  .object({
    policyId: identifier,
    name: z.string().min(1).max(200),
    description: z.string().max(500).optional(),
    document: z.json(),
    activate: z.boolean(),
    expectedLatestVersion: z.number().int().min(1).nullable(),
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
  trace: string[];
  approval_id: string | null;
  expires_at: Date;
  created_at: Date;
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
  async replay(
    tx: Tx,
    p: Principal,
    scope: string,
    key: string | undefined,
    input: unknown,
  ) {
    if (!key) return undefined;
    const row = (
      await tx.query(
        'SELECT * FROM idempotency_records WHERE tenant_id=$1 AND principal_id=$2 AND scope=$3 AND request_id=$4',
        [p.tenantId, p.id, scope, key],
      )
    ).rows[0];
    if (row && row.digest !== digest(input))
      throw new DomainError(409, 'IDEMPOTENCY_CONFLICT');
    return row?.response as Record<string, unknown> | undefined;
  }
  async remember(
    tx: Tx,
    p: Principal,
    scope: string,
    key: string | undefined,
    input: unknown,
    result: unknown,
  ) {
    if (key)
      await tx.query(
        'INSERT INTO idempotency_records(tenant_id,principal_id,scope,request_id,digest,response) VALUES($1,$2,$3,$4,$5,$6)',
        [p.tenantId, p.id, scope, key, digest(input), result],
      );
  }
  async trustedRequest(
    tx: Tx,
    p: Principal,
    request: Evaluation,
  ): Promise<Evaluation> {
    const metadata = (
      await tx.query(
        'SELECT attributes FROM resource_metadata WHERE tenant_id=$1 AND type=$2 AND id=$3',
        [p.tenantId, request.resource.type, request.resource.id],
      )
    ).rows[0];
    // Caller metadata never supplies server-owned resource attributes to the engine.
    return {
      ...request,
      resource: { ...request.resource, attributes: metadata?.attributes ?? {} },
    };
  }
  async evaluate(
    p: Principal,
    request: Evaluation,
    correlationId: string,
  ): Promise<DecisionResponse> {
    return this.store.transaction(p.tenantId, async (tx) => {
      await this.store.authorizeAgent(
        tx,
        p,
        request.agentId,
        request.action,
        request.resource.type,
        request.resource.id,
      );
      const replay = await this.replay(
        tx,
        p,
        'evaluate',
        request.requestId,
        request,
      );
      if (replay) return replay as unknown as DecisionResponse;
      const old = (
        await tx.query<DecisionRow>(
          'SELECT * FROM decisions WHERE tenant_id=$1 AND principal_id=$2 AND request_id=$3',
          [p.tenantId, p.id, request.requestId],
        )
      ).rows[0];
      if (old) {
        if (old.request_digest !== digest(request))
          throw new DomainError(409, 'IDEMPOTENCY_CONFLICT');
        return response(old);
      }
      const policy = await this.policy(tx, p.tenantId);
      if (request.approvalId) {
        const row = (
          await tx.query(
            `SELECT d.*,a.state,a.required_role,a.prohibit_self,a.resolved_by FROM approvals a JOIN decisions d ON d.tenant_id=a.tenant_id AND d.id=a.decision_id WHERE a.tenant_id=$1 AND a.id=$2 AND d.principal_id=$3`,
            [p.tenantId, request.approvalId, p.id],
          )
        ).rows[0];
        if (!row) throw new DomainError(404, 'APPROVAL_NOT_FOUND');
        const { approvalId: _, ...original } = request;
        void _;
        if (
          digest({ ...original, requestId: row.request_id }) !==
          row.request_digest
        )
          throw new DomainError(409, 'APPROVAL_BINDING_MISMATCH');
        if (
          !policy ||
          policy.version !== row.policy_version ||
          row.expires_at.getTime() <= Date.now() ||
          !['PENDING', 'APPROVED'].includes(row.state)
        )
          throw new DomainError(403, 'APPROVAL_REQUIRED_OR_EXPIRED');
        const fresh = await boundedPolicy(this.engine, {
          tenantId: p.tenantId,
          principal: p,
          request: await this.trustedRequest(tx, p, original),
          policy,
        });
        if (fresh.effect === 'DENY')
          throw new DomainError(403, 'POLICY_REEVALUATION_DENIED');
        if (
          fresh.effect === 'REQUIRE_APPROVAL' &&
          (fresh.approval?.requiredRole !== row.required_role ||
            fresh.approval?.prohibitSelf !== row.prohibit_self)
        )
          throw new DomainError(403, 'APPROVAL_AUTHORITY_CHANGED');
        if (
          row.state === 'APPROVED' &&
          !(
            await tx.query(
              'SELECT id FROM lock_principal($1,$2) WHERE kind=$3 AND $4=ANY(roles)',
              [p.tenantId, row.resolved_by, 'human', row.required_role],
            )
          ).rowCount
        )
          throw new DomainError(403, 'APPROVER_AUTHORITY_REVOKED');
        const result = {
          ...response(row),
          effect:
            row.state === 'APPROVED'
              ? ('ALLOW' as const)
              : ('REQUIRE_APPROVAL' as const),
          reasonCodes:
            row.state === 'APPROVED' ? ['APPROVAL_SATISFIED'] : row.reasons,
        };
        await this.remember(
          tx,
          p,
          'evaluate',
          request.requestId,
          request,
          result,
        );
        await audit(tx, p.tenantId, 'DECISION', p.id, correlationId, {
          decisionId: row.id,
          effect: result.effect,
          approvalId: row.approval_id,
        });
        return result;
      }
      const result = policy
        ? await boundedPolicy(this.engine, {
            tenantId: p.tenantId,
            principal: p,
            request: await this.trustedRequest(tx, p, request),
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
          p.tenantId,
          decisionId,
          request.requestId,
          p.id,
          request.agentId,
          digest(request),
          request.argumentsDigest ?? 'none',
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
            p.tenantId,
            approvalId,
            decisionId,
            'PENDING',
            result.approval.requiredRole,
            result.approval.prohibitSelf,
            expiresAt,
          ],
        );
        await audit(tx, p.tenantId, 'APPROVAL_CREATED', p.id, correlationId, {
          approvalId,
          decisionId,
        });
      }
      await audit(tx, p.tenantId, 'DECISION', p.id, correlationId, {
        decisionId,
        effect: result.effect,
        reasonCodes: result.reasonCodes,
        policyVersion: version,
        requestDigest: digest(request),
        requestId: request.requestId,
        action: request.action,
        resource: { type: request.resource.type, id: request.resource.id },
        agentId: request.agentId,
      });
      const output = {
        decisionId,
        effect: result.effect,
        reasonCodes: result.reasonCodes,
        policyVersion: version,
        approvalId,
        expiresAt: expiresAt.toISOString(),
      };
      await this.remember(
        tx,
        p,
        'evaluate',
        request.requestId,
        request,
        output,
      );
      return output;
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
  async approvalView(tx: Tx, p: Principal, id: string) {
    const row = (
      await tx.query(
        `SELECT d.*,a.id AS aid,a.state,a.resolved_by,a.resolved_at,aa.action AS resolution_action,aa.comment
      FROM approvals a JOIN decisions d ON d.tenant_id=a.tenant_id AND d.id=a.decision_id
      LEFT JOIN LATERAL (SELECT action,comment FROM approval_actions WHERE tenant_id=a.tenant_id AND approval_id=a.id ORDER BY created_at DESC LIMIT 1) aa ON true
      WHERE a.tenant_id=$1 AND a.id=$2`,
        [p.tenantId, id],
      )
    ).rows[0];
    if (!row) throw new DomainError(404, 'APPROVAL_NOT_FOUND');
    const binding = approvalBinding({ ...p, id: row.principal_id }, row);
    return {
      approvalId: row.aid,
      tenantId: p.tenantId,
      decisionId: row.id,
      requestId: row.request_id,
      agentId: row.agent_id,
      requestingPrincipalId: row.principal_id,
      action: row.action,
      resource: {
        type: row.resource_type,
        id: row.resource_id,
        attributes: {},
      },
      argumentsDigest:
        row.arguments_digest === 'none' ? null : row.arguments_digest,
      bindingDigest: binding,
      policyVersion: row.policy_version,
      matchedRuleIds: row.trace,
      reasonCodes: row.reasons,
      status: row.state,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      resolution:
        row.resolved_by && row.resolution_action
          ? {
              decision: row.resolution_action,
              resolvedBy: row.resolved_by,
              resolvedAt: row.resolved_at.toISOString(),
              comment: row.comment ?? null,
              bindingDigest: binding,
            }
          : null,
    };
  }
  async resolve(
    p: Principal,
    id: string,
    input: z.infer<typeof resolutionSchema>,
    correlationId: string,
    key?: string,
  ) {
    if (p.kind !== 'human')
      throw new DomainError(403, 'HUMAN_APPROVER_REQUIRED');
    return this.store.transaction(p.tenantId, async (tx) => {
      await this.store.currentPrincipal(tx, p);
      const row = (
        await tx.query(
          `SELECT a.*,d.principal_id,d.policy_version,d.agent_id,d.action,d.resource_type,d.resource_id,d.arguments_digest FROM approvals a JOIN decisions d ON d.tenant_id=a.tenant_id AND d.id=a.decision_id WHERE a.tenant_id=$1 AND a.id=$2 FOR UPDATE OF a`,
          [p.tenantId, id],
        )
      ).rows[0];
      if (!row) throw new DomainError(404, 'APPROVAL_NOT_FOUND');
      requireRole(p, row.required_role);
      if (row.prohibit_self && row.principal_id === p.id)
        throw new DomainError(409, 'SELF_APPROVAL_FORBIDDEN');
      if (
        approvalBinding({ ...p, id: row.principal_id }, row) !==
        input.expectedBindingDigest
      )
        throw new DomainError(409, 'APPROVAL_BINDING_MISMATCH');
      const replay = await this.replay(tx, p, 'resolve', key, {
        approvalId: id,
        ...input,
      });
      if (replay) return replay;
      if (row.state !== 'PENDING' || row.expires_at.getTime() <= Date.now())
        throw new DomainError(409, 'APPROVAL_NOT_PENDING');
      if ((await this.policy(tx, p.tenantId))?.version !== row.policy_version)
        throw new DomainError(409, 'POLICY_VERSION_CHANGED');
      const state = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      await tx.query(
        'UPDATE approvals SET state=$3,resolved_by=$4,resolved_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2',
        [p.tenantId, id, state, p.id],
      );
      await tx.query(
        'INSERT INTO approval_actions(tenant_id,id,approval_id,actor_id,request_id,action,comment) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          p.tenantId,
          randomUUID(),
          id,
          p.id,
          key ?? randomUUID(),
          input.decision,
          input.comment ?? null,
        ],
      );
      await audit(tx, p.tenantId, 'APPROVAL_RESOLVED', p.id, correlationId, {
        approvalId: id,
        state,
      });
      const output = await this.approvalView(tx, p, id);
      await this.remember(
        tx,
        p,
        'resolve',
        key,
        { approvalId: id, ...input },
        output,
      );
      return output;
    });
  }
  async writePolicy(
    p: Principal,
    input: z.infer<typeof policyWriteSchema>,
    correlationId: string,
    key?: string,
  ) {
    requireRole(p, 'policy:admin');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        !(await Promise.race([
          this.engine.validatePolicy(input.document),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1500);
          }),
        ]))
      )
        throw new DomainError(400, 'POLICY_INVALID');
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(503, 'POLICY_ENGINE_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
    return this.store.transaction(p.tenantId, async (tx) => {
      await this.store.currentPrincipal(tx, p);
      const replay = await this.replay(tx, p, 'policy:write', key, input);
      if (replay) return replay;
      const old = (
        await tx.query(
          'SELECT * FROM policy_catalog WHERE tenant_id=$1 AND id=$2',
          [p.tenantId, input.policyId],
        )
      ).rows[0];
      if ((old?.latest_version ?? null) !== input.expectedLatestVersion)
        throw new DomainError(409, 'CONFLICT');
      const version = Number(old?.latest_version ?? 0) + 1;
      await tx.query(
        `INSERT INTO policy_catalog(tenant_id,id,name,description,latest_version,active_version) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id,id) DO UPDATE SET name=excluded.name,description=excluded.description,latest_version=excluded.latest_version,active_version=CASE WHEN $7 THEN excluded.active_version ELSE policy_catalog.active_version END,updated_at=clock_timestamp()`,
        [
          p.tenantId,
          input.policyId,
          input.name,
          input.description ?? null,
          version,
          input.activate ? version : null,
          input.activate,
        ],
      );
      await tx.query(
        'INSERT INTO policy_revisions(tenant_id,policy_id,version,document,digest,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [
          p.tenantId,
          input.policyId,
          version,
          JSON.stringify(input.document),
          publicDigest(input.document),
          p.id,
        ],
      );
      if (input.activate) {
        const active = await tx.query(
          'SELECT r.policy_id AS "policyId",r.version,r.document FROM policy_catalog c JOIN policy_revisions r ON r.tenant_id=c.tenant_id AND r.policy_id=c.id AND r.version=c.active_version WHERE c.tenant_id=$1 ORDER BY c.id',
          [p.tenantId],
        );
        if (active.rows.length > 64)
          throw new DomainError(400, 'POLICY_INVALID');
        const revision = Number(
          (
            await tx.query(
              'UPDATE tenants SET policy_revision=policy_revision+1 WHERE id=$1 RETURNING policy_revision',
              [p.tenantId],
            )
          ).rows[0].policy_revision,
        );
        const document = {
          tenantId: p.tenantId,
          revision,
          policies: active.rows,
        };
        const snapshot = `r${revision}.${digest({ kind: 'aegis.policy-set/v1', ...document }).slice(0, 12)}`;
        await tx.query(
          'INSERT INTO policies(tenant_id,version,document,digest,created_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [p.tenantId, snapshot, document, digest(document), p.id],
        );
        await tx.query('UPDATE tenants SET active_policy=$2 WHERE id=$1', [
          p.tenantId,
          snapshot,
        ]);
        const cancelled = await tx.query(
          "UPDATE approvals SET state='CANCELLED' WHERE tenant_id=$1 AND state IN ('PENDING','APPROVED') RETURNING id",
          [p.tenantId],
        );
        for (const row of cancelled.rows)
          await audit(
            tx,
            p.tenantId,
            'APPROVAL_CANCELLED',
            p.id,
            correlationId,
            { approvalId: row.id },
          );
        await audit(tx, p.tenantId, 'POLICY_ACTIVATED', p.id, correlationId, {
          policyVersion: snapshot,
        });
      }
      await audit(tx, p.tenantId, 'POLICY_CREATED', p.id, correlationId, {
        policyId: input.policyId,
        version,
        documentDigest: publicDigest(input.document),
      });
      const output = {
        policyId: input.policyId,
        tenantId: p.tenantId,
        version,
        state: input.activate ? 'ACTIVE' : 'DRAFT',
        documentDigest: publicDigest(input.document),
        document: input.document,
        createdBy: p.id,
        createdAt: new Date().toISOString(),
      };
      await this.remember(tx, p, 'policy:write', key, input, output);
      return output;
    });
  }
}
