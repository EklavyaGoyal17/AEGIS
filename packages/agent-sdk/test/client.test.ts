import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AegisApiError,
  AegisAuthError,
  AegisCancelledError,
  AegisClient,
  AegisProtocolError,
  AegisTimeoutError,
  AegisUnavailableError,
  AegisValidationError,
  type Logger,
} from '../src/index.js';
import { client, decision, envelope, evaluateRequest, hang, json, scriptedFetch, TOKEN } from './harness.js';

const example = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../contracts/examples/${name}.json`, import.meta.url), 'utf8'));

describe('request construction', () => {
  it('sends a contract-valid evaluate request with auth, correlation and JSON headers', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW'))]);
    const res = await client(fetch).evaluate(evaluateRequest());
    expect(res.effect).toBe('ALLOW');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.href).toBe('https://aegis.test/v1/decisions/evaluate');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'x-correlation-id': expect.any(String),
    });
    expect(calls[0]!.body).toEqual(evaluateRequest());
  });

  it('rejects contract-invalid requests locally without any network call', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW'))]);
    const bad = { ...evaluateRequest(), tenantId: 'tnt_other' };
    await expect(client(fetch).evaluate(bad as never)).rejects.toBeInstanceOf(AegisValidationError);
    await expect(client(fetch).evaluate({ ...evaluateRequest(), context: { nested: { a: 1 } } } as never)).rejects.toBeInstanceOf(
      AegisValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses plain-http and credential-bearing base URLs (except localhost for development)', () => {
    const creds = { getToken: async () => 't' };
    expect(() => new AegisClient({ baseUrl: 'http://aegis.example.com', credentials: creds })).toThrow(AegisValidationError);
    expect(() => new AegisClient({ baseUrl: 'https://u:p@aegis.example.com', credentials: creds })).toThrow(AegisValidationError);
    expect(() => new AegisClient({ baseUrl: 'http://localhost:8080', credentials: creds })).not.toThrow();
  });

  it('does not send credentials to the health endpoint', async () => {
    const { fetch, calls } = scriptedFetch([json(200, example('health-response'))]);
    await client(fetch).health();
    expect(calls[0]!.headers['authorization']).toBeUndefined();
  });

  it('sends a stable Idempotency-Key for approval resolution and validates the path id', async () => {
    const approved = example('approval-request-approved');
    const { fetch, calls } = scriptedFetch([json(503, envelope('UNAVAILABLE', true)), json(200, approved)]);
    const c = client(fetch);
    await c.resolveApproval(approved.approvalId, example('resolve-approval-request'));
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers['idempotency-key']).toBeDefined();
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    await expect(c.resolveApproval('../../v1/policies', example('resolve-approval-request'))).rejects.toBeInstanceOf(AegisValidationError);
  });

  it('serialises list queries and validates paged responses', async () => {
    const { fetch, calls } = scriptedFetch([json(200, example('audit-event-page'))]);
    const page = await client(fetch).listAuditEvents({ limit: 10, type: 'DECISION_EVALUATED' });
    expect(page.items).toHaveLength(2);
    expect(calls[0]!.url.search).toBe('?limit=10&type=DECISION_EVALUATED');
  });
});

describe('response validation (fail closed)', () => {
  it.each<[string, Response]>([
    ['wrong shape', json(200, { effect: 'ALLOW' })],
    ['unknown effect', json(200, decision('ALLOW', { effect: 'PERMIT' }))],
    ['REQUIRE_APPROVAL without approvalId', json(200, decision('REQUIRE_APPROVAL', { approvalId: null }))],
    ['non-JSON content type', new Response('ALLOW', { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['malformed JSON', new Response('{"effect":', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['oversized body', new Response('x'.repeat(2_000_000), { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('%s → AegisProtocolError, no retry', async (_label, response) => {
    const { fetch, calls } = scriptedFetch([response]);
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisProtocolError);
    expect(calls).toHaveLength(1);
  });

  it('rejects an execution authorization bound to a different request', async () => {
    const ea = example('evaluate-response-allow').executionAuthorization;
    const body = decision('ALLOW', { executionAuthorization: { ...ea, bindings: { ...ea.bindings, decisionId: '7b6a5948-3726-4154-a3b2-c1d0e9f8a7b6' } } });
    const { fetch } = scriptedFetch([json(200, body)]);
    // bindings name crm.customers.export on "customers" but with an argumentsDigest the request did not send
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toThrow('execution authorization does not match');
  });

  it('tolerates unknown response fields (forward compatibility)', async () => {
    const { fetch } = scriptedFetch([json(200, { ...decision('DENY'), futureField: 1 })]);
    expect((await client(fetch).evaluate(evaluateRequest())).effect).toBe('DENY');
  });
});

describe('retry classification', () => {
  it.each<[string, Response | Error]>([
    ['503 retryable envelope', json(503, envelope('UNAVAILABLE', true))],
    ['502 HTML from a proxy', new Response('<html>bad gateway</html>', { status: 502 })],
    ['504', new Response('', { status: 504 })],
    ['429', json(429, envelope('RATE_LIMITED', true), { 'retry-after': '1' })],
    ['network error', new TypeError('fetch failed')],
  ])('retries %s, then succeeds with the same requestId and correlation id', async (_label, first) => {
    const { fetch, calls } = scriptedFetch([first, json(200, decision('DENY'))]);
    const res = await client(fetch).evaluate(evaluateRequest());
    expect(res.effect).toBe('DENY');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(calls[1]!.headers['x-correlation-id']).toBe(calls[0]!.headers['x-correlation-id']);
  });

  it.each<[number, string, typeof AegisApiError | typeof AegisAuthError]>([
    [400, 'INVALID_REQUEST', AegisApiError],
    [401, 'UNAUTHENTICATED', AegisAuthError],
    [403, 'FORBIDDEN', AegisApiError],
    [404, 'NOT_FOUND', AegisApiError],
    [409, 'IDEMPOTENCY_CONFLICT', AegisApiError],
    [500, 'INTERNAL', AegisApiError],
  ])('does not retry %i %s', async (status, code, type) => {
    const { fetch, calls } = scriptedFetch([json(status, envelope(code, false)), json(200, decision('ALLOW'))]);
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toBeInstanceOf(type);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 503 the server marked non-retryable', async () => {
    const { fetch, calls } = scriptedFetch([json(503, envelope('UNAVAILABLE', false)), json(200, decision('ALLOW'))]);
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisUnavailableError);
    expect(calls).toHaveLength(1);
  });

  it('a 500 claiming retryable is still not retried (status class wins)', async () => {
    const { fetch, calls } = scriptedFetch([json(500, envelope('INTERNAL', true)), json(200, decision('ALLOW'))]);
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisApiError);
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxAttempts with AegisUnavailableError (never a permissive default)', async () => {
    const { fetch, calls } = scriptedFetch([new TypeError('ECONNREFUSED')]);
    await expect(client(fetch).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisUnavailableError);
    expect(calls).toHaveLength(3);
  });

  it('stops retrying when the next backoff would cross the deadline', async () => {
    let t = 0;
    const { fetch, calls } = scriptedFetch([json(503, envelope('UNAVAILABLE', true), { 'retry-after': '5' })]);
    const c = client(fetch, { now: () => t, sleep: async (ms) => { t += ms; }, deadlineMs: 3000, retry: { maxAttempts: 5, maxDelayMs: 10_000 } });
    await expect(c.evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisUnavailableError);
    expect(calls).toHaveLength(1);
  });
});

describe('timeouts, cancellation, credentials', () => {
  it('times out a hung server and retries (evaluate is idempotent), then fails closed', async () => {
    const { fetch, calls } = scriptedFetch([hang]);
    await expect(client(fetch, { timeoutMs: 20 }).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisTimeoutError);
    expect(calls).toHaveLength(3);
  });

  it('honours caller cancellation immediately and does not retry', async () => {
    const controller = new AbortController();
    const { fetch, calls } = scriptedFetch([
      (_c, signal) => {
        setTimeout(() => controller.abort(), 5);
        return hang(_c, signal);
      },
    ]);
    await expect(client(fetch, { timeoutMs: 1000 }).evaluate(evaluateRequest(), { signal: controller.signal })).rejects.toBeInstanceOf(
      AegisCancelledError,
    );
    expect(calls).toHaveLength(1);
  });

  it('a pre-aborted signal makes no request', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW'))]);
    const controller = new AbortController();
    controller.abort();
    await expect(client(fetch).evaluate(evaluateRequest(), { signal: controller.signal })).rejects.toBeInstanceOf(AegisCancelledError);
    expect(calls).toHaveLength(0);
  });

  it('fails closed when the credential provider fails or returns a header-injection token', async () => {
    const { fetch, calls } = scriptedFetch([json(200, decision('ALLOW'))]);
    await expect(client(fetch, { credentials: { getToken: async () => { throw new Error('vault down'); } } }).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisAuthError);
    await expect(client(fetch, { credentials: { getToken: async () => 'abc\r\nX-Admin: 1' } }).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisAuthError);
    await expect(client(fetch, { credentials: { getToken: async () => '' } }).evaluate(evaluateRequest())).rejects.toBeInstanceOf(AegisAuthError);
    expect(calls).toHaveLength(0);
  });

  it('fetches a fresh token per attempt', async () => {
    let n = 0;
    const { fetch, calls } = scriptedFetch([json(503, envelope('UNAVAILABLE', true)), json(200, decision('DENY'))]);
    await client(fetch, { credentials: { getToken: async () => `tok-${++n}` } }).evaluate(evaluateRequest());
    expect(calls.map((c) => c.headers['authorization'])).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('refuses redirects so the bearer token cannot leak to another origin', async () => {
    let seen: RequestInit | undefined;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return json(200, decision('DENY'));
    }) as typeof fetch;
    await client(fetchImpl).evaluate(evaluateRequest());
    expect(seen?.redirect).toBe('error');
  });
});

describe('logging', () => {
  it('emits structured events without tokens, context or attribute values', async () => {
    const lines: string[] = [];
    const logger: Logger = { log: (level, event, fields) => lines.push(JSON.stringify({ level, event, fields })) };
    const req = { ...evaluateRequest(), context: { note: 'customer SSN 123-45-6789' } };
    const { fetch } = scriptedFetch([json(503, envelope('UNAVAILABLE', true)), json(200, decision('ALLOW'))]);
    await client(fetch, {}, logger).evaluate(req);
    const all = lines.join('\n');
    expect(lines.length).toBe(2);
    expect(all).toContain('aegis.request');
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('123-45-6789');
    expect(all).not.toContain('recordCount');
  });

  it('a throwing logger cannot change the outcome', async () => {
    const logger: Logger = { log: () => { throw new Error('disk full'); } };
    const { fetch } = scriptedFetch([json(200, decision('DENY'))]);
    expect((await client(fetch, {}, logger).evaluate(evaluateRequest())).effect).toBe('DENY');
  });
});
