import { readFileSync } from 'node:fs';
import type { Attributes, PolicyDocument } from '@aegis/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AegisApiError, AegisClient, AegisGuard } from '../src/index.js';
import { createEnforcementPoint, InMemoryReplayStore } from '../src/enforcement.js';
import { createMockBackend } from './mock-backend.js';

/*
 * Cross-component abuse cases (agent ↔ AEGIS ↔ gateway). Threat ids refer to docs/security/threat-model.md.
 */

const TENANT = 'tnt_acme';
const policyDocument = JSON.parse(
  readFileSync(new URL('../../contracts/examples/policy-document.json', import.meta.url), 'utf8'),
) as PolicyDocument;
const clock = new Date('2026-11-02T10:30:00Z');

function world() {
  const backend = createMockBackend({
    now: () => clock,
    audience: 'crm-tool-gateway',
    policySet: { tenantId: TENANT, revision: 7, policies: [{ policyId: 'data-export-controls', version: 7, document: policyDocument }] },
    agents: [
      { agentId: 'agent-crm', tenantId: TENANT, ownerPrincipalId: 'usr_alice', displayName: 'CRM', status: 'ACTIVE', attributes: {}, credentialRefIds: [], createdAt: '2026-01-01T00:00:00Z' },
      { agentId: 'agent-other', tenantId: TENANT, ownerPrincipalId: 'usr_alice', displayName: 'Other', status: 'ACTIVE', attributes: {}, credentialRefIds: [], createdAt: '2026-01-01T00:00:00Z' },
    ],
    principals: [{ principalId: 'usr_alice', tenantId: TENANT, kind: 'HUMAN', displayName: 'Alice', status: 'ACTIVE', attributes: {}, createdAt: '2026-01-01T00:00:00Z' }],
    grants: ['agent-crm', 'agent-other'].map((agentId, n) => ({
      grantId: `g${n}`, tenantId: TENANT, agentId, delegatorPrincipalId: 'usr_alice', actions: ['crm.customers.*'], scopes: [{ resourceType: 'crm.customer_table' }],
      maxSensitivity: 'confidential' as const, notBefore: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-01-01T00:00:00Z',
    })),
    tokens: {
      'agent-token': { kind: 'agent', tenantId: TENANT, agentId: 'agent-crm' },
      'other-agent-token': { kind: 'agent', tenantId: TENANT, agentId: 'agent-other' },
    },
    catalog: { 'crm.customer_table/customers': { sensitivity: 'confidential' } },
    environment: { networkZone: 'corp', businessHours: true },
  });
  const client = (token: string) =>
    new AegisClient({ baseUrl: 'https://aegis.test', credentials: { getToken: async () => token }, fetch: backend.fetch, retry: { maxAttempts: 1 }, now: () => clock.getTime() });
  const gatewayFor = (audience: string) =>
    createEnforcementPoint({ audience, keys: backend.gatewayKeys, replayStore: new InMemoryReplayStore(), now: () => clock });
  return { backend, client, agent: new AegisGuard(client('agent-token'), { now: () => clock.getTime() }), gateway: gatewayFor('crm-tool-gateway'), gatewayFor };
}

type ExportArgs = { table: string; destination: string; limit: number };
/** Shared between agent and gateway: the policy-relevant attributes are a pure function of the arguments. */
const deriveAttributes = (a: Readonly<ExportArgs>): Attributes => ({
  recordCount: a.limit,
  destination: a.destination.startsWith('internal://') ? 'internal' : 'external',
});
const call = (args: ExportArgs, attributes: Attributes) => ({
  agentId: 'agent-crm',
  action: 'crm.customers.export',
  resource: { type: 'crm.customer_table', id: 'customers', attributes },
  args,
});
const target = { tenantId: TENANT, action: 'crm.customers.export', resource: { type: 'crm.customer_table', id: 'customers' } };

describe('T18 claimed attributes vs. actual arguments', () => {
  const bulk: ExportArgs = { table: 'customers', destination: 's3://attacker/x.csv', limit: 15000 };
  const lie: Attributes = { recordCount: 500, destination: 'internal' }; // what a malicious agent claims

  it('a lying agent obtains an ALLOW for its claims, but a gateway that re-derives attributes refuses to execute', async () => {
    const w = world();
    const auth = await w.agent.authorize(call(bulk, lie));
    expect(auth.decision.effect).toBe('ALLOW'); // the policy evaluated the lie...
    const tool = vi.fn();
    await expect(
      w.gateway.execute({ ...target, token: auth.executionAuthorization!.token, agentId: 'agent-crm', args: bulk, deriveAttributes }, tool),
    ).rejects.toMatchObject({ reason: 'BINDING_MISMATCH', field: 'att' });
    expect(tool).not.toHaveBeenCalled(); // ...but the truth was checked at the enforcement point
  });

  it('LIMITATION (documented): a gateway that does not re-derive attributes cannot detect the lie', async () => {
    const w = world();
    const auth = await w.agent.authorize(call(bulk, lie));
    const tool = vi.fn(async (a: Readonly<ExportArgs>) => a.limit);
    await expect(w.gateway.execute({ ...target, token: auth.executionAuthorization!.token, agentId: 'agent-crm', args: bulk }, tool)).resolves.toBe(15000);
  });

  it('an honest agent using the shared deriveAttributes passes the gateway check', async () => {
    const w = world();
    const small: ExportArgs = { table: 'customers', destination: 'internal://warehouse', limit: 200 };
    const auth = await w.agent.authorize({ ...call(small, {}), deriveAttributes });
    const tool = vi.fn(async (a: Readonly<ExportArgs>) => a.limit);
    await expect(
      w.gateway.execute({ ...target, token: auth.executionAuthorization!.token, agentId: 'agent-crm', args: small, deriveAttributes }, tool),
    ).resolves.toBe(200);
  });

  it('deriving attributes from the real bulk args routes the honest agent to approval', async () => {
    const w = world();
    await expect(w.agent.authorize({ ...call(bulk, lie), deriveAttributes })).rejects.toMatchObject({ decision: { effect: 'REQUIRE_APPROVAL' } });
  });
});

describe('T16 compromised or unintegrated client', () => {
  const small: ExportArgs = { table: 'customers', destination: 'internal://warehouse', limit: 200 };

  it('skipping AEGIS entirely gets nothing executed at the gateway', async () => {
    const w = world();
    const tool = vi.fn();
    for (const token of [undefined, '', 'not-a-token', 'a.b.c']) {
      await expect(w.gateway.execute({ ...target, token, agentId: 'agent-crm', args: small }, tool)).rejects.toMatchObject({ name: 'AegisExecutionRejectedError' });
    }
    expect(tool).not.toHaveBeenCalled();
  });

  it('a token stolen from another agent is useless', async () => {
    const w = world();
    const auth = await w.agent.authorize({ ...call(small, {}), deriveAttributes });
    await expect(
      w.gateway.execute({ ...target, token: auth.executionAuthorization!.token, agentId: 'agent-other', args: small }, vi.fn()),
    ).rejects.toMatchObject({ reason: 'BINDING_MISMATCH', field: 'sub' });
  });

  it('a token minted for one gateway cannot be spent at another', async () => {
    const w = world();
    const auth = await w.agent.authorize({ ...call(small, {}), deriveAttributes });
    await expect(
      w.gatewayFor('billing-gateway').execute({ ...target, token: auth.executionAuthorization!.token, agentId: 'agent-crm', args: small }, vi.fn()),
    ).rejects.toMatchObject({ reason: 'AUDIENCE_MISMATCH' });
  });
});

describe('T3 forged identity / T9 idempotency abuse at the API', () => {
  it('an agent credential cannot request decisions as another agent', async () => {
    const w = world();
    const c = w.client('agent-token');
    const err = await c
      .evaluate({ requestId: '0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978', agentId: 'agent-other', action: 'crm.customers.read', resource: { type: 'crm.customer_table', id: 'customers', attributes: {} }, context: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AegisApiError);
    expect((err as AegisApiError).status).toBe(403);
  });

  it('reusing a requestId with a different body is a conflict, not a cached ALLOW', async () => {
    const w = world();
    const c = w.client('agent-token');
    const base = { requestId: '0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978', agentId: 'agent-crm', action: 'crm.customers.read', resource: { type: 'crm.customer_table', id: 'customers', attributes: {} }, context: {} };
    expect((await c.evaluate(base)).effect).toBe('ALLOW');
    await expect(c.evaluate({ ...base, action: 'crm.customers.export' })).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });
});
