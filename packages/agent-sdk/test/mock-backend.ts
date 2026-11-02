/*
 * In-memory reference backend used by the SDK end-to-end tests. It is NOT production code, but it implements
 * the server obligations from docs/security/integration-requirements.md so the backend team can compare:
 * identity binding, idempotency, server-owned attributes, approval binding + CAS consumption, EA minting.
 */
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import {
  EvaluateDecisionRequest,
  ResolveApprovalRequest,
  validate,
  type AgentIdentity,
  type ApprovalRequest,
  type DelegatedAuthority,
  type EvaluateDecisionResponse,
  type Principal,
} from '@aegis/contracts';
import { computeAttributesDigest, mintExecutionAuthorization, sha256Digest } from '@aegis/contracts/crypto';
import { compilePolicySet, evaluate, type CompiledPolicySet, type PolicySet } from '@aegis/policy-engine';

type Caller =
  | { kind: 'agent'; tenantId: string; agentId: string }
  | { kind: 'principal'; tenantId: string; principalId: string; scopes: string[] };

export interface MockBackendConfig {
  now: () => Date;
  policySet: PolicySet;
  agents: AgentIdentity[];
  principals: Principal[];
  grants: DelegatedAuthority[];
  tokens: Record<string, Caller>;
  /** Server-owned resource attributes from the catalog, keyed by "type/id". */
  catalog: Record<string, Record<string, string>>;
  environment: Record<string, string | boolean>;
  audience: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, retryable = false) =>
  json(status, { error: { code, message: code, correlationId: 'mock', retryable } });
const ts = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function createMockBackend(config: MockBackendConfig) {
  const keys = generateKeyPairSync('ed25519');
  const compiled = compilePolicySet(config.policySet);
  if (!compiled.ok) throw new Error('mock policy invalid');
  const policy: CompiledPolicySet = compiled;
  const approvals = new Map<string, ApprovalRequest>();
  const decisions = new Map<string, { digest: string; response: EvaluateDecisionResponse }>();
  const state = { available: true, agentStatus: new Map<string, AgentIdentity['status']>() };

  function evaluateRoute(caller: Caller, body: unknown): Response {
    const checked = validate(EvaluateDecisionRequest, body);
    if (!checked.ok) return fail(400, 'INVALID_REQUEST');
    const req = checked.value;
    if (caller.kind !== 'agent' || caller.agentId !== req.agentId) return fail(403, 'FORBIDDEN');
    const tenantId = caller.tenantId;

    const idemKey = `${tenantId}/${req.agentId}/${req.requestId}`;
    const prior = decisions.get(idemKey);
    if (prior) return prior.digest === sha256Digest(req) ? json(200, prior.response) : fail(409, 'IDEMPOTENCY_CONFLICT');

    const agentRecord = config.agents.find((a) => a.agentId === req.agentId && a.tenantId === tenantId);
    if (!agentRecord) return fail(403, 'FORBIDDEN');
    const agent = { ...agentRecord, status: state.agentStatus.get(agentRecord.agentId) ?? agentRecord.status };
    const principal = config.principals.find((p) => p.principalId === agent.ownerPrincipalId && p.tenantId === tenantId);
    if (!principal) return fail(403, 'FORBIDDEN');

    // Server-owned attributes overwrite caller claims; absent catalog values are deleted.
    const attributes: Record<string, unknown> = { ...req.resource.attributes };
    for (const k of ['sensitivity', 'classification', 'ownerTenantId', 'owner', 'dataResidency']) delete attributes[k];
    Object.assign(attributes, config.catalog[`${req.resource.type}/${req.resource.id}`] ?? {});
    const resource = { ...req.resource, attributes };

    const found = req.approvalId ? approvals.get(req.approvalId) : undefined;
    const approval = found && found.tenantId === tenantId ? found : null;
    const now = config.now();
    const d = evaluate(policy, {
      now: ts(now),
      tenantId,
      request: req,
      resource,
      agent,
      principal,
      grants: config.grants.filter((g) => g.tenantId === tenantId && g.agentId === agent.agentId),
      environment: config.environment,
      approval,
    });

    const decisionId = randomUUID();
    let effect = d.effect;
    let reasonCodes = [...d.reasonCodes] as string[];
    let approvalId: string | null = null;
    let expiresAt = new Date(now.getTime() + d.decisionTtlSeconds * 1000);

    if (effect === 'REQUIRE_APPROVAL' && d.approval) {
      if (approval && approval.status === 'PENDING') {
        approvalId = approval.approvalId;
        expiresAt = new Date(approval.expiresAt);
      } else {
        approvalId = randomUUID();
        expiresAt = new Date(now.getTime() + d.approval.ttlSeconds * 1000);
        approvals.set(approvalId, {
          approvalId,
          tenantId,
          decisionId,
          requestId: req.requestId,
          agentId: agent.agentId,
          requestingPrincipalId: principal.principalId,
          action: req.action,
          resource,
          argumentsDigest: req.argumentsDigest ?? null,
          bindingDigest: d.approval.bindingDigest,
          policyVersion: d.policyVersion,
          matchedRuleIds: d.matchedRules.map((m) => `${m.policyId}/${m.ruleId}`),
          reasonCodes,
          status: 'PENDING',
          createdAt: ts(now),
          expiresAt: ts(expiresAt),
          resolution: null,
        } as ApprovalRequest);
      }
    }
    if (effect === 'ALLOW' && d.consumesApprovalId) {
      const a = approvals.get(d.consumesApprovalId);
      // Compare-and-set APPROVED → CONSUMED; losing the race is a DENY.
      if (!a || a.status !== 'APPROVED') {
        effect = 'DENY';
        reasonCodes = ['APPROVAL_ALREADY_CONSUMED'];
      } else {
        a.status = 'CONSUMED';
        approvalId = a.approvalId;
      }
    }

    const response: EvaluateDecisionResponse = {
      decisionId,
      effect,
      reasonCodes,
      policyVersion: d.policyVersion,
      approvalId,
      expiresAt: ts(expiresAt),
    };
    if (effect === 'ALLOW') {
      const lifetime = Math.max(1, Math.min(60, d.decisionTtlSeconds));
      const { token, claims } = mintExecutionAuthorization(
        {
          iss: 'aegis-mock',
          aud: config.audience,
          tid: tenantId,
          sub: agent.agentId,
          prn: principal.principalId,
          act: req.action,
          res: { type: req.resource.type, id: req.resource.id },
          args: req.argumentsDigest ?? null,
          att: computeAttributesDigest(req.resource.attributes),
          dec: decisionId,
          apr: approvalId,
          pv: d.policyVersion,
        },
        { privateKey: keys.privateKey, kid: 'mock-k1', now, lifetimeSeconds: lifetime },
      );
      response.executionAuthorization = {
        token,
        tokenType: 'aegis-ea+jwt',
        singleUse: true,
        expiresAt: ts(new Date(claims.exp * 1000)),
        bindings: {
          agentId: agent.agentId,
          action: req.action,
          resource: { type: req.resource.type, id: req.resource.id },
          argumentsDigest: req.argumentsDigest ?? null,
          decisionId,
          approvalId,
          audience: config.audience,
        },
      };
    }
    decisions.set(idemKey, { digest: sha256Digest(req), response });
    return json(200, response);
  }

  function resolveRoute(caller: Caller, approvalId: string, body: unknown): Response {
    if (caller.kind !== 'principal' || !caller.scopes.includes('aegis:approvals:resolve')) return fail(403, 'FORBIDDEN');
    const checked = validate(ResolveApprovalRequest, body);
    if (!checked.ok) return fail(400, 'INVALID_REQUEST');
    const a = approvals.get(approvalId);
    if (!a || a.tenantId !== caller.tenantId) return fail(404, 'NOT_FOUND');
    if (caller.principalId === a.requestingPrincipalId) return fail(409, 'SELF_APPROVAL_FORBIDDEN');
    if (checked.value.expectedBindingDigest !== a.bindingDigest) return fail(409, 'APPROVAL_BINDING_MISMATCH');
    if (a.status !== 'PENDING') return fail(409, 'APPROVAL_NOT_PENDING');
    a.status = checked.value.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    a.resolution = {
      decision: checked.value.decision,
      resolvedBy: caller.principalId,
      resolvedAt: ts(config.now()),
      comment: checked.value.comment ?? null,
      bindingDigest: a.bindingDigest,
    };
    return json(200, a);
  }

  const fetchImpl = (async (input: URL | string | Request, init?: RequestInit) => {
    if (!state.available) throw new TypeError('fetch failed: ECONNREFUSED');
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers['authorization'] ?? '';
    const caller = config.tokens[auth.replace(/^Bearer /, '')];
    if (url.pathname === '/v1/health') return json(200, { status: 'ok', apiVersion: '1.0.0', time: ts(config.now()) });
    if (!caller) return fail(401, 'UNAUTHENTICATED');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    if (init?.method === 'POST' && url.pathname === '/v1/decisions/evaluate') return evaluateRoute(caller, body);
    const m = /^\/v1\/approvals\/([0-9a-f-]{36})\/resolve$/.exec(url.pathname);
    if (init?.method === 'POST' && m) return resolveRoute(caller, m[1]!, body);
    if (url.pathname === '/v1/approvals') {
      const items = [...approvals.values()].filter((a) => a.tenantId === caller.tenantId);
      return json(200, { items, nextCursor: null });
    }
    return fail(404, 'NOT_FOUND');
  }) as typeof fetch;

  return {
    fetch: fetchImpl,
    gatewayKeys: new Map<string, KeyObject>([['mock-k1', keys.publicKey]]),
    approvals,
    setAvailable(v: boolean) {
      state.available = v;
    },
    suspendAgent(agentId: string) {
      state.agentStatus.set(agentId, 'SUSPENDED');
    },
    isAgentSuspended(agentId: string) {
      return state.agentStatus.get(agentId) === 'SUSPENDED';
    },
  };
}
