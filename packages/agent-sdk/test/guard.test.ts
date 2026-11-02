import { computeArgumentsDigest } from '@aegis/contracts/crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AegisApprovalRequiredError,
  AegisAuthorizationExpiredError,
  AegisDeniedError,
  AegisGuard,
  AegisProtocolError,
  AegisTimeoutError,
  AegisValidationError,
} from '../src/index.js';
import { client, decision, hang, json, scriptedFetch } from './harness.js';

const args = { table: 'customers', limit: 10 };
const req = <A = typeof args>(a: A = args as A, extra: Record<string, unknown> = {}) => ({
  agentId: 'agent-crm',
  action: 'crm.customers.export',
  resource: { type: 'crm.customer_table', id: 'customers', attributes: {} },
  args: a,
  requestId: '0b5f1d2e-8a4c-4e7b-9f61-2d3c4b5a6978',
  ...extra,
});

const ea = (digest = computeArgumentsDigest(args), expiresAt = '2999-01-01T00:00:00Z') => ({
  token: 'opaque.token.value',
  tokenType: 'aegis-ea+jwt',
  singleUse: true,
  expiresAt,
  bindings: {
    agentId: 'agent-crm',
    action: 'crm.customers.export',
    resource: { type: 'crm.customer_table', id: 'customers' },
    argumentsDigest: digest,
    decisionId: '7b6a5948-3726-4154-a3b2-c1d0e9f8a7b6',
    approvalId: null,
    audience: 'gw',
  },
});

describe('AegisGuard', () => {
  it('sends the arguments digest and executes exactly once on ALLOW with the frozen snapshot', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW', { executionAuthorization: ea() }))]);
    const executor = vi.fn(async (auth: { args: Readonly<typeof args> }) => auth.args.limit);
    const original = { ...args };
    const result = await new AegisGuard(client(fetch)).execute(req(original), executor);
    expect(result).toBe(10);
    expect(executor).toHaveBeenCalledTimes(1);
    expect((calls[0]!.body as { argumentsDigest: string }).argumentsDigest).toBe(computeArgumentsDigest(args));
    const received = executor.mock.calls[0]![0].args;
    expect(Object.isFrozen(received)).toBe(true);
    expect(received).not.toBe(original);
  });

  it('the caller mutating its args object during authorization cannot change what executes', async () => {
    const mutable = { ...args };
    const { fetch } = scriptedFetch([
      () => {
        mutable.limit = 1_000_000; // races the evaluation
        return json(200, decision('ALLOW', { executionAuthorization: ea() }));
      },
    ]);
    const executor = vi.fn(async (auth: { args: Readonly<typeof args> }) => auth.args.limit);
    expect(await new AegisGuard(client(fetch)).execute(req(mutable), executor)).toBe(10);
  });

  it('never executes on DENY', async () => {
    const { fetch } = scriptedFetch([json(200, decision('DENY'))]);
    const executor = vi.fn();
    await expect(new AegisGuard(client(fetch)).execute(req(), executor)).rejects.toBeInstanceOf(AegisDeniedError);
    expect(executor).not.toHaveBeenCalled();
  });

  it('never executes on REQUIRE_APPROVAL and exposes the approvalId', async () => {
    const { fetch } = scriptedFetch([json(200, decision('REQUIRE_APPROVAL'))]);
    const executor = vi.fn();
    const err = (await new AegisGuard(client(fetch)).execute(req(), executor).catch((e: unknown) => e)) as AegisApprovalRequiredError;
    expect(err).toBeInstanceOf(AegisApprovalRequiredError);
    expect(err.approvalId).toBe('3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c');
    expect(executor).not.toHaveBeenCalled();
  });

  it('refuses an ALLOW without an execution authorization by default', async () => {
    const { fetch } = scriptedFetch([json(200, decision('ALLOW'))]);
    const executor = vi.fn();
    await expect(new AegisGuard(client(fetch)).execute(req(), executor)).rejects.toBeInstanceOf(AegisProtocolError);
    expect(executor).not.toHaveBeenCalled();
    // Explicit opt-out for decision-only integrations (documented as weaker).
    const ok = scriptedFetch([json(200, decision('ALLOW'))]);
    await new AegisGuard(client(ok.fetch), { requireExecutionAuthorization: false }).execute(req(), executor);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired decision or an expired execution authorization', async () => {
    const expiredDecision = scriptedFetch([json(200, decision('ALLOW', { expiresAt: '2020-01-01T00:00:00Z', executionAuthorization: ea() }))]);
    const executor = vi.fn();
    await expect(new AegisGuard(client(expiredDecision.fetch)).execute(req(), executor)).rejects.toBeInstanceOf(AegisAuthorizationExpiredError);
    const expiredEa = scriptedFetch([json(200, decision('ALLOW', { executionAuthorization: ea(undefined, '2020-01-01T00:00:00Z') }))]);
    await expect(new AegisGuard(client(expiredEa.fetch)).execute(req(), executor)).rejects.toBeInstanceOf(AegisAuthorizationExpiredError);
    expect(executor).not.toHaveBeenCalled();
  });

  it('re-checks expiry immediately before executing', async () => {
    let t = Date.parse('2026-11-02T10:00:00Z');
    const { fetch } = scriptedFetch([json(200, decision('ALLOW', { expiresAt: '2026-11-02T10:00:30Z', executionAuthorization: ea(undefined, '2026-11-02T10:00:30Z') }))]);
    const guard = new AegisGuard(client(fetch), { now: () => t });
    const auth = await guard.authorize(req());
    expect(auth.decision.effect).toBe('ALLOW');
    t += 31_000;
    const executor = vi.fn();
    const again = scriptedFetch([json(200, decision('ALLOW', { expiresAt: '2026-11-02T10:00:30Z', executionAuthorization: ea(undefined, '2026-11-02T10:00:30Z') }))]);
    await expect(new AegisGuard(client(again.fetch), { now: () => t }).execute(req(), executor)).rejects.toBeInstanceOf(AegisAuthorizationExpiredError);
    expect(executor).not.toHaveBeenCalled();
  });

  it('rejects arguments that cannot be canonically digested, without calling the service', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW'))]);
    const guard = new AegisGuard(client(fetch));
    for (const bad of [{ f: () => 1 }, { n: 1n }, { u: undefined }, { d: Number.NaN }, new Map()]) {
      await expect(guard.authorize(req(bad))).rejects.toBeInstanceOf(AegisValidationError);
    }
    expect(calls).toHaveLength(0);
  });

  it('a timeout never results in execution', async () => {
    const { fetch } = scriptedFetch([hang]);
    const executor = vi.fn();
    await expect(new AegisGuard(client(fetch, { timeoutMs: 10 })).execute(req(), executor)).rejects.toBeInstanceOf(AegisTimeoutError);
    expect(executor).not.toHaveBeenCalled();
  });

  it('propagates executor errors unchanged', async () => {
    const { fetch } = scriptedFetch([json(200, decision('ALLOW', { executionAuthorization: ea() }))]);
    const boom = new Error('tool failed');
    await expect(new AegisGuard(client(fetch)).execute(req(), async () => { throw boom; })).rejects.toBe(boom);
  });

  it('sends approvalId when resuming an approved request', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW', { executionAuthorization: ea() }))]);
    await new AegisGuard(client(fetch)).authorize(req(args, { approvalId: '3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c' }));
    expect((calls[0]!.body as { approvalId: string }).approvalId).toBe('3c9a4f1e-2b7d-4e8a-9c6f-1d2e3f4a5b6c');
  });
});
