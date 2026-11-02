import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Authorization,
  type DecisionRow,
} from '../../api/src/authorization.js';
import {
  boundedPolicy,
  argumentsDigest,
  digest,
  DomainError,
  evaluationSchema,
  type Evaluation,
  type Principal,
} from '../../api/src/domain.js';
import { audit } from '../../api/src/store.js';

export const executionSchema = z
  .object({
    decisionId: z.uuid(),
    request: evaluationSchema,
    arguments: z.record(z.string(), z.json()),
  })
  .strict();
export const noteArguments = z
  .object({ text: z.string().min(1).max(4096) })
  .strict();
export interface ToolAdapter {
  readonly id: 'demo-note';
  execute(input: {
    executionId: string;
    tenantId: string;
    request: Evaluation;
    arguments: unknown;
    signal: AbortSignal;
  }): Promise<void>;
}
/** The configured endpoint is immutable. Agent input never supplies a URL or HTTP headers. */
export class DemoNoteAdapter implements ToolAdapter {
  readonly id = 'demo-note' as const;
  private readonly endpoint: URL;
  constructor(
    origin: string,
    private readonly secret: string,
    development: boolean,
  ) {
    const url = new URL(origin);
    const hosts = development
      ? ['127.0.0.1', 'localhost', 'demo-tool']
      : ['demo-tool'];
    if (
      !hosts.includes(url.hostname) ||
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !url.port ||
      secret.length < 32
    )
      throw new Error('Invalid isolated demo connector configuration');
    this.endpoint = new URL('/internal/notes', url);
  }
  async execute(input: Parameters<ToolAdapter['execute']>[0]) {
    if (
      input.request.action !== 'demo.note.create' ||
      input.request.resource.type !== 'note'
    )
      throw new DomainError(403, 'ADAPTER_ACTION_MISMATCH');
    const args = noteArguments.parse(input.arguments);
    const result = await fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(3000)]),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.secret}`,
      },
      body: JSON.stringify({
        executionId: input.executionId,
        tenantId: input.tenantId,
        noteId: input.request.resource.id,
        text: args.text,
      }),
    });
    // Discard untrusted response bodies; they never participate in subsequent authorization.
    await result.body?.cancel();
    if (!result.ok) throw new Error('DEMO_TOOL_REJECTED');
  }
}
export class Gateway {
  constructor(
    readonly authorization: Authorization,
    readonly adapter: ToolAdapter,
  ) {}
  async execute(
    principal: Principal,
    input: z.infer<typeof executionSchema>,
    correlationId: string,
    signal: AbortSignal,
  ) {
    if (
      principal.kind !== 'machine' ||
      !principal.connector ||
      !principal.roles.includes('tool:execute')
    )
      throw new DomainError(403, 'TRUSTED_CONNECTOR_REQUIRED');
    const { store, engine } = this.authorization;
    const claim = await store.transaction(principal.tenantId, async (tx) => {
      await store.authorizeAgent(
        tx,
        principal,
        input.request.agentId,
        input.request.action,
        input.request.resource.type,
      );
      const decision = (
        await tx.query<DecisionRow>(
          'SELECT * FROM decisions WHERE tenant_id=$1 AND id=$2 AND principal_id=$3',
          [principal.tenantId, input.decisionId, principal.id],
        )
      ).rows[0];
      if (!decision) throw new DomainError(404, 'DECISION_NOT_FOUND');
      if (
        decision.request_digest !== digest(input.request) ||
        decision.arguments_digest !== argumentsDigest(input.arguments)
      )
        throw new DomainError(403, 'AUTHORIZATION_BINDING_MISMATCH');
      const existing = (
        await tx.query(
          'SELECT id,state FROM executions WHERE tenant_id=$1 AND decision_id=$2',
          [principal.tenantId, decision.id],
        )
      ).rows[0];
      // A deterministic retry reports the prior execution and never invokes the adapter again.
      if (existing)
        return {
          id: existing.id as string,
          state: existing.state as string,
          claimed: false,
        };
      if (decision.expires_at.getTime() <= Date.now())
        throw new DomainError(403, 'AUTHORIZATION_EXPIRED');
      if (decision.effect === 'DENY')
        throw new DomainError(403, 'DECISION_DENIED');
      const connector = (
        await tx.query(
          'SELECT id FROM connectors WHERE tenant_id=$1 AND id=$2 AND adapter=$2 AND enabled FOR SHARE',
          [principal.tenantId, this.adapter.id],
        )
      ).rows[0];
      if (!connector) throw new DomainError(403, 'CONNECTOR_DISABLED');
      if (
        input.request.action !== 'demo.note.create' ||
        input.request.resource.type !== 'note'
      )
        throw new DomainError(403, 'ADAPTER_ACTION_MISMATCH');
      noteArguments.parse(input.arguments);
      const policy = await this.authorization.policy(tx, principal.tenantId);
      if (!policy || policy.version !== decision.policy_version)
        throw new DomainError(403, 'POLICY_VERSION_CHANGED');
      const result = await boundedPolicy(engine, {
        tenantId: principal.tenantId,
        principal,
        request: await this.authorization.trustedRequest(
          tx,
          principal,
          input.request,
        ),
        policy,
      });
      // Re-evaluation may tighten requirements; it cannot widen the stored authorization.
      if (
        result.effect === 'DENY' ||
        (decision.effect === 'ALLOW' && result.effect !== 'ALLOW')
      )
        throw new DomainError(403, 'POLICY_REEVALUATION_DENIED');
      if (decision.effect === 'REQUIRE_APPROVAL') {
        const approval = (
          await tx.query(
            'SELECT * FROM approvals WHERE tenant_id=$1 AND id=$2 AND decision_id=$3 FOR UPDATE',
            [principal.tenantId, decision.approval_id, decision.id],
          )
        ).rows[0];
        if (
          !approval ||
          approval.state !== 'APPROVED' ||
          approval.expires_at.getTime() <= Date.now()
        )
          throw new DomainError(403, 'APPROVAL_REQUIRED_OR_EXPIRED');
        if (
          result.effect === 'REQUIRE_APPROVAL' &&
          (result.approval?.requiredRole !== approval.required_role ||
            result.approval?.prohibitSelf !== approval.prohibit_self)
        )
          throw new DomainError(403, 'APPROVAL_AUTHORITY_CHANGED');
        // Revoking the human approver's authority also invalidates an unconsumed approval.
        const approver = (
          await tx.query(
            'SELECT id FROM principals WHERE tenant_id=$1 AND id=$2 AND NOT disabled AND kind=$3 AND $4=ANY(roles) FOR SHARE',
            [
              principal.tenantId,
              approval.resolved_by,
              'human',
              approval.required_role,
            ],
          )
        ).rows[0];
        if (!approver) throw new DomainError(403, 'APPROVER_AUTHORITY_REVOKED');
        await tx.query(
          "UPDATE approvals SET state='CONSUMED' WHERE tenant_id=$1 AND id=$2",
          [principal.tenantId, approval.id],
        );
        await audit(
          tx,
          principal.tenantId,
          'APPROVAL_CONSUMED',
          principal.id,
          correlationId,
          { approvalId: approval.id, decisionId: decision.id },
        );
      }
      if (signal.aborted) throw new DomainError(409, 'REQUEST_CANCELLED');
      const executionId = randomUUID();
      await tx.query(
        "INSERT INTO executions(tenant_id,id,decision_id,connector_id,state) VALUES($1,$2,$3,$4,'STARTED')",
        [principal.tenantId, executionId, decision.id, this.adapter.id],
      );
      await audit(
        tx,
        principal.tenantId,
        'EXECUTION_STARTED',
        principal.id,
        correlationId,
        {
          executionId,
          decisionId: decision.id,
          argumentsDigest: decision.arguments_digest,
        },
      );
      return { id: executionId, state: 'STARTED', claimed: true };
    });
    if (!claim.claimed) return { executionId: claim.id, state: claim.state };
    let state: 'SUCCEEDED' | 'UNKNOWN' = 'UNKNOWN';
    try {
      if (!signal.aborted) {
        await this.adapter.execute({
          executionId: claim.id,
          tenantId: principal.tenantId,
          request: input.request,
          arguments: input.arguments,
          signal,
        });
        state = 'SUCCEEDED';
      }
    } catch {
      /* A timeout or disconnect cannot prove the remote side effect did not occur. */
    }
    // A DB failure here leaves STARTED, which recovery conservatively changes to UNKNOWN.
    await store.transaction(principal.tenantId, async (tx) => {
      await tx.query(
        'UPDATE executions SET state=$3,outcome_code=$4,completed_at=clock_timestamp() WHERE tenant_id=$1 AND id=$2 AND state=$5',
        [
          principal.tenantId,
          claim.id,
          state,
          state === 'SUCCEEDED' ? 'TOOL_OK' : 'RECONCILIATION_REQUIRED',
          'STARTED',
        ],
      );
      await audit(
        tx,
        principal.tenantId,
        'EXECUTION_OUTCOME',
        principal.id,
        correlationId,
        { executionId: claim.id, state },
      );
    });
    return { executionId: claim.id, state };
  }
}
