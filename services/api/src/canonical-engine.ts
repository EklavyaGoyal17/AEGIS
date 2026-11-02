import type { Store } from './store.js';
import { DomainError, evaluationSchema, type PolicyEngine } from './domain.js';

interface ContextArgs {
  tenantId: string;
  principalId: string;
  request: unknown;
  signal: AbortSignal;
}
interface FactoryOptions {
  approverRole: string;
  loadContext(args: ContextArgs): Promise<Record<string, unknown>>;
}
/** Imports Claude's package. This adapter only loads trusted context; it does not evaluate policy. */
export async function canonicalPolicyEngine(
  store: Store,
  moduleSpecifier: string = '@aegis/policy-engine',
): Promise<PolicyEngine> {
  const module: Record<string, unknown> = await import(moduleSpecifier);
  if (typeof module.createBackendPolicyEngine !== 'function')
    throw new Error('Canonical policy adapter export unavailable');
  const create = module.createBackendPolicyEngine as (
    options: FactoryOptions,
  ) => PolicyEngine;
  return create({
    approverRole: 'approval:write',
    loadContext: async (args) => {
      if (args.signal.aborted) throw new Error('Policy evaluation cancelled');
      const request = evaluationSchema.parse(args.request);
      const principalResult = await store.contextQuery(
        args.tenantId,
        'SELECT * FROM principals WHERE tenant_id=$1 AND id=$2 AND NOT disabled',
        [args.tenantId, args.principalId],
      );
      const agentResult = await store.contextQuery(
        args.tenantId,
        'SELECT * FROM agents WHERE tenant_id=$1 AND id=$2 AND NOT disabled',
        [args.tenantId, request.agentId],
      );
      const grantResult = await store.contextQuery(
        args.tenantId,
        'SELECT * FROM delegations WHERE tenant_id=$1 AND principal_id=$2 AND agent_id=$3',
        [args.tenantId, args.principalId, request.agentId],
      );
      const environmentResult = await store.contextQuery(
        args.tenantId,
        'SELECT attributes FROM tenant_environment WHERE tenant_id=$1',
        [args.tenantId],
      );
      const principal = principalResult.rows[0];
      const agent = agentResult.rows[0];
      if (!principal || !agent?.owner_principal_id)
        throw new DomainError(403, 'REGISTRY_CONTEXT_UNAVAILABLE');
      return {
        principal: {
          principalId: principal.id,
          tenantId: principal.tenant_id,
          kind: principal.kind === 'human' ? 'HUMAN' : 'SERVICE',
          displayName: principal.subject.slice(0, 200),
          status: 'ACTIVE',
          attributes: principal.attributes,
          createdAt: principal.created_at.toISOString(),
        },
        agent: {
          agentId: agent.id,
          tenantId: agent.tenant_id,
          ownerPrincipalId: agent.owner_principal_id,
          displayName: agent.id,
          status: 'ACTIVE',
          attributes: agent.attributes,
          credentialRefIds: [],
          createdAt: agent.created_at.toISOString(),
        },
        grants: grantResult.rows.map((grant) => ({
          grantId: grant.id,
          tenantId: grant.tenant_id,
          agentId: grant.agent_id,
          delegatorPrincipalId: grant.principal_id,
          actions: grant.actions,
          scopes: grant.resource_types.map((resourceType: string) => ({
            resourceType,
            ...(grant.resource_ids ? { resourceIds: grant.resource_ids } : {}),
          })),
          maxSensitivity: grant.max_sensitivity,
          notBefore: grant.not_before.toISOString(),
          expiresAt: grant.expires_at.toISOString(),
          revokedAt: grant.revoked_at?.toISOString() ?? null,
          createdAt: grant.created_at.toISOString(),
        })),
        environment: environmentResult.rows[0]?.attributes ?? {},
        approval: null,
        resource: request.resource,
      };
    },
  });
}
